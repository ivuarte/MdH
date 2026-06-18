import axios from 'axios';
import { config } from '../config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { RateLimiter } from './rateLimiter.js';
import { health } from './health.js';

class GlpiClient {
  constructor() {
    this.http = axios.create({
      baseURL: config.GLPI_BASE_URL,
      timeout: config.GLPI_TIMEOUT_MS,
      headers: {
        'App-Token': config.APP_TOKEN,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      validateStatus: s => s >= 200 && s < 300
    });
    this.sessionToken = config.SESSION_TOKEN || null;
    this.breaker = new CircuitBreaker('glpi');
    this.limiter = new RateLimiter(config.GLPI_RATE_LIMIT);
    this.loginInFlight = null;
  }

  async ensureSession() {
    if (this.sessionToken) return this.sessionToken;
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      const url = `/initSession?app_token=${encodeURIComponent(config.APP_TOKEN)}&user_token=${encodeURIComponent(config.USER_TOKEN)}`;
      const res = await this.http.post(url);
      const tok = res.data?.session_token;
      if (!tok) throw new Error('No se obtuvo session_token de GLPI');
      this.sessionToken = tok;
      logger.info('GLPI sesión iniciada', { service: 'glpi' });
      return tok;
    })();

    try {
      return await this.loginInFlight;
    } finally {
      this.loginInFlight = null;
    }
  }

  invalidateSession() {
    this.sessionToken = null;
  }

  authHeaders(extra = {}) {
    if (!this.sessionToken) throw new Error('GLPI: sesión no inicializada');
    return {
      'Session-Token': this.sessionToken,
      'App-Token': config.APP_TOKEN,
      'Accept': 'application/json',
      ...extra
    };
  }

  // Wrapper único: rate limit + circuit breaker + retry + relogin transparente.
  async request(method, path, { body, headers, params, range } = {}) {
    const label = `glpi ${method} ${path}`;

    const doOnce = async () => {
      await this.limiter.acquire();
      await this.ensureSession();
      const reqHeaders = this.authHeaders(headers || {});
      if (range) reqHeaders.Range = range;
      try {
        const res = await this.http.request({
          method, url: path, data: body, headers: reqHeaders, params
        });
        return res.data;
      } finally {
        health.setBreaker(this.breaker.snapshot());
      }
    };

    return await this.breaker.exec(() =>
      withRetry(async () => {
        try {
          return await doOnce();
        } catch (err) {
          const status = err?.response?.status;
          // 401 → session expirada; 403 → permission denied (no reloguear).
          if (status === 401) {
            logger.warn('GLPI sesión expirada, relogueando', { service: 'glpi', status, path });
            this.invalidateSession();
            return await doOnce();
          }
          throw err;
        }
      }, { label })
    );
  }

  // Métodos de conveniencia.
  get(path, opts = {}) { return this.request('GET', path, opts); }
  post(path, body, opts = {}) { return this.request('POST', path, { ...opts, body }); }
  put(path, body, opts = {}) { return this.request('PUT', path, { ...opts, body }); }
  del(path, opts = {}) { return this.request('DELETE', path, opts); }

  // Operaciones de alto nivel.
  async getLog({ range = 'items=0-99', order = 'DESC' } = {}) {
    return this.get(`/Log?order=${order}`, { range });
  }
  async getTicket(id) {
    return this.get(`/Ticket/${id}?expand_dropdowns=true`);
  }
  // Versión sin expand: devuelve los dropdowns como IDs numéricos (no como nombres).
  // Necesario para capturar itilcategories_id como número y poder mapearlo a Aranda.
  async getTicketRaw(id) {
    return this.get(`/Ticket/${id}`);
  }
  async getTicketFollowups(id) {
    return this.get(`/Ticket/${id}/ITILFollowup?expand_dropdowns=true`);
  }
  async getTicketSolutions(id) {
    return this.get(`/Ticket/${id}/ITILSolution?expand_dropdowns=true`);
  }
  async addFollowup(ticketId, content) {
    return this.post(`/ITILFollowup/`, { input: { itemtype: 'Ticket', items_id: ticketId, content } });
  }
  async addSolution(ticketId, content) {
    return this.post(`/ITILSolution/`, { input: { itemtype: 'Ticket', items_id: ticketId, content } });
  }
  async createTicket(input) {
    return this.post(`/Ticket`, { input });
  }
  async updateTicket(input) {
    return this.put(`/Ticket`, { input });
  }
  // ITILTask/TicketTask — distinto de ITILFollowup. En GLPI las tareas tienen estado, tiempo de acción,
  // técnico asignado y fechas de inicio/fin. Esta integración sólo sincroniza el contenido + autor.
  async getTicketTasks(id) {
    return this.get(`/Ticket/${id}/TicketTask?expand_dropdowns=true`);
  }
  async addTicketTask(ticketId, content, { state = 1, isPrivate = 0 } = {}) {
    return this.post(`/TicketTask/`, { input: { tickets_id: ticketId, content, state, is_private: isPrivate } });
  }
  // --- Adjuntos ---
  // Lista documentos vinculados al ticket (via Document_Item endpoint).
  async getTicketDocuments(ticketId) {
    return this.get(`/Ticket/${ticketId}/Document_Item?expand_dropdowns=false`);
  }
  // Metadata de un documento.
  async getDocument(documentId) {
    return this.get(`/Document/${documentId}`);
  }
  // Sube un documento y lo enlaza al ticket. Requiere multipart/form-data.
  // GLPI exige la estructura:
  //   uploadManifest: JSON {"input": {"name": <X>, "_filename": [<filename>], "itemtype":"Ticket","items_id":<id>}}
  //   filename[0]: <binario>
  // Buffer/Uint8Array para el contenido. Devuelve {id} del nuevo Document.
  async uploadDocumentToTicket(ticketId, buffer, filename, mimetype = 'application/octet-stream') {
    await this.ensureSession();
    await this.limiter.acquire();
    const form = new FormData();
    const manifest = {
      input: {
        name: filename,
        _filename: [filename],
        itemtype: 'Ticket',
        items_id: ticketId
      }
    };
    form.append('uploadManifest', JSON.stringify(manifest));
    form.append('filename[0]', new Blob([buffer], { type: mimetype }), filename);

    // CRÍTICO: la instancia axios tiene Content-Type:application/json por default.
    // Hay que sobrescribirlo a undefined para que axios+FormData generen multipart/form-data
    // con el boundary automático. Si no, GLPI devuelve ERROR_BAD_ARRAY.
    const headers = {
      'Session-Token': this.sessionToken,
      'App-Token': config.APP_TOKEN,
      'Accept': 'application/json',
      'Content-Type': undefined
    };
    const res = await this.http.post('/Document/', form, { headers });
    health.setBreaker(this.breaker.snapshot());
    const data = res.data;
    const id = Array.isArray(data) ? Number(data[0]?.id) : Number(data?.id);
    if (!Number.isFinite(id)) throw new Error(`GLPI upload sin id: ${JSON.stringify(data).slice(0, 300)}`);
    return id;
  }

  // Descarga el binario del Document. Convención GLPI REST: GET /Document/{id}?alt=media
  // devuelve el archivo en bruto con Content-Type del documento original. Header obligatorio:
  // Accept: application/octet-stream. Devuelve {buffer, mime, size}.
  async downloadDocumentBinary(documentId) {
    await this.ensureSession();
    await this.limiter.acquire();
    const headers = {
      'Session-Token': this.sessionToken,
      'App-Token': config.APP_TOKEN,
      'Accept': 'application/octet-stream'
    };
    const res = await this.http.get(`/Document/${documentId}?alt=media`, {
      headers,
      responseType: 'arraybuffer',
      validateStatus: s => s >= 200 && s < 300
    });
    health.setBreaker(this.breaker.snapshot());
    return {
      buffer: Buffer.from(res.data),
      mime: res.headers['content-type'] || 'application/octet-stream',
      size: Number(res.headers['content-length']) || res.data.length
    };
  }
}

export const glpiClient = new GlpiClient();
