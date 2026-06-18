import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config.js';
import { logger } from './logger.js';
import { withRetry } from './retry.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { RateLimiter } from './rateLimiter.js';
import { fieldsArrayToObject, truthy } from './utils.js';
import { health } from './health.js';

class ArandaClient {
  constructor() {
    this.http = axios.create({
      baseURL: config.ARANDA_BASE_URL,
      timeout: config.ARANDA_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: s => s >= 200 && s < 300
    });
    this.sessionId = null;
    this.breaker = new CircuitBreaker('aranda');
    this.limiter = new RateLimiter(config.ARANDA_RATE_LIMIT);
    this.loginInFlight = null;
  }

  async ensureLogin() {
    if (this.sessionId) return this.sessionId;
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      const payload = [
        { Field: 'username', Value: config.ARANDA_USERNAME },
        { Field: 'password', Value: config.ARANDA_PASSWORD }
      ];
      const res = await this.http.post('/user/login', payload);
      const obj = fieldsArrayToObject(res.data);
      if (!truthy(obj.result) || !obj.sessionId) {
        throw new Error(`Login Aranda falló: ${JSON.stringify(obj)}`);
      }
      this.sessionId = obj.sessionId;
      logger.info('Aranda sesión iniciada', { service: 'aranda' });
      return this.sessionId;
    })();

    try {
      return await this.loginInFlight;
    } finally {
      this.loginInFlight = null;
    }
  }

  invalidateSession() {
    this.sessionId = null;
  }

  authHeaders() {
    if (!this.sessionId) throw new Error('Aranda: sesión no inicializada');
    return { Authorization: this.sessionId };
  }

  async request(method, path, { body } = {}) {
    const label = `aranda ${method} ${path}`;

    // Ejecuta un POST/GET con un retry transparente si la respuesta es 401/403
    // (sesión expirada/invalidada). Sin contar ese intento contra los retries de fallos transitorios.
    const doOnce = async () => {
      await this.limiter.acquire();
      await this.ensureLogin();
      try {
        const res = await this.http.request({
          method, url: path, data: body, headers: this.authHeaders()
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
          // Solo 401 indica sesión expirada en Aranda. 403 es permiso denegado para ESE recurso —
          // no tiene sentido relogar (la sesión es válida, el problema es ACL del item).
          if (status === 401) {
            logger.warn('Aranda sesión expirada, relogueando', { service: 'aranda', status, path });
            this.invalidateSession();
            return await doOnce();
          }
          throw err;
        }
      }, { label })
    );
  }

  // Métodos de conveniencia.
  post(path, body) { return this.request('POST', path, { body }); }
  get(path) { return this.request('GET', path); }

  // Operaciones de alto nivel.
  async addItem(segment, fieldsArray) {
    const data = await this.post(`/item/add/${segment}`, fieldsArray);
    return fieldsArrayToObject(data);
  }
  async updateItem(itemId, segment, userId, fieldsArray) {
    const data = await this.post(`/item/update/${itemId}/${segment}/${userId}`, fieldsArray);
    return fieldsArrayToObject(data);
  }
  async addNote(itemId, segment, { description, isPrivate = false }) {
    const data = await this.post(`/item/${itemId}/${segment}/note`, {
      Description: description || '',
      IsPrivate: !!isPrivate
    });
    return fieldsArrayToObject(data);
  }
  async getItemDetail(itemId, segment) {
    return this.get(`/item/${itemId}/${segment}`);
  }
  // Lista el historial completo de un item Aranda: notas, cambios de estado, asignaciones, tareas, etc.
  // Cada entry tiene { ActionType, ActionName, Description, AuthorName, CreationDate, Id, IsPrivate, ChatSessionId, AfterClosed, AdditionalData }.
  // ActionType conocidos: 2=ENRUTAR, 4=MODIFICAR ITEM, 10=CREAR ITEM, 16=NOTA, 20=CAMPO ADICIONAL, 22=AGREGAR TAREA.
  // Importante: el campo Id viene 0 — no es estable. Usar hash compuesto para deduplicar.
  async getItemNoteList(itemId, segment) {
    return this.get(`/item/${itemId}/${segment}/note/list`);
  }
  async listItems(body) {
    return this.post('/item/list', body);
  }
  // Lista adjuntos del caso. Endpoint descubierto:
  //   GET /item/{itemId}/{segment}/{userId}/files
  // Devuelve [{Id, Name, Size, Url, Created, IsPublic}, ...]. El campo Url
  // contiene un token firmado y sirve para descargar directamente con axios.
  async listItemFiles(itemId, segment, userId) {
    return this.get(`/item/${itemId}/${segment}/${userId}/files`);
  }
  // Sube un binario al item Aranda. Endpoint documentado en
  // https://docs.arandasoft.com/asdk-api/pages/V1.9/descripcion/adjuntar_archivos.html
  //   POST /item/addfile  (multipart/form-data)
  //   fields: file0 (binario), itemId, itemType (= segmento), userId
  //   response: [{FileName, Info, Result:true}]
  // Validado contra v8.6 (probe-aranda-addfile.js, 2026-06-17).
  async addFileToItem(itemId, segment, userId, { filename, buffer, mime = 'application/octet-stream' }) {
    await this.limiter.acquire();
    await this.ensureLogin();
    const form = new FormData();
    form.append('file0', buffer, { filename, contentType: mime });
    form.append('itemId',   String(itemId));
    form.append('itemType', String(segment));
    form.append('userId',   String(userId));
    const headers = {
      ...this.authHeaders(),
      ...form.getHeaders()  // sobreescribe Content-Type: application/json del axios singleton
    };
    const res = await this.http.post('/item/addfile', form, {
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
    health.setBreaker(this.breaker.snapshot());
    const arr = Array.isArray(res.data) ? res.data : [];
    const entry = arr.find(x => x && (x.FileName === filename || x.fileName === filename)) || arr[0];
    if (!entry || entry.Result !== true) {
      throw new Error(`Aranda /item/addfile rechazó ${filename}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    return entry;
  }

  // Descarga binaria desde la Url firmada de Aranda (la Url no requiere Authorization).
  async downloadFileFromUrl(url) {
    await this.limiter.acquire();
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: config.ARANDA_TIMEOUT_MS,
      validateStatus: s => s >= 200 && s < 300
    });
    return {
      buffer: Buffer.from(res.data),
      mime: res.headers['content-type'] || 'application/octet-stream',
      size: Number(res.headers['content-length']) || res.data.length
    };
  }
}

export const arandaClient = new ArandaClient();
