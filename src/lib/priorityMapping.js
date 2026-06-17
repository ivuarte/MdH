// Mapeos de urgencia y prioridad entre GLPI y Aranda.
//
// GLPI: urgency/impact/priority son escala 1..5 (1=Muy bajo, 5=Muy alto). Default GLPI=3.
// Aranda Urgency: SOLO 3 valores (Id-Value en /urgency/list):
//   2=LOW, 3=HIGH, 4=CRITICAL (no hay MEDIUM/MEDIO en este catálogo)
// Aranda Priority: 4 valores (/priority/list):
//   1=LOW, 2=MEDIUM, 3=HIGH, 4=CRITICAL
// Aranda Impact: /impact/list → 404. El bot no puede leer ni escribir este campo.
//
// Por la asimetría (GLPI=5 vs Aranda Urgency=3), el mapeo es lossy en una dirección:
// GLPI 1 y 2 colapsan en Aranda LOW; GLPI 3 y 4 colapsan en Aranda HIGH.

// --- URGENCY ---

// GLPI urgency (1..5) → Aranda UrgencyId (2|3|4)
export function glpiUrgencyToAranda(glpiUrgency) {
  const u = Number(glpiUrgency);
  if (u <= 2) return 2;         // Muy bajo / Bajo  → LOW
  if (u === 3 || u === 4) return 3;  // Mediano / Alto    → HIGH (Aranda no tiene MEDIUM en urgency)
  if (u >= 5) return 4;         // Muy alto          → CRITICAL
  return null;
}

// Aranda UrgencyId (2|3|4) → GLPI urgency (1..5)
// Como Aranda colapsa MEDIUM con HIGH, mapeamos a la mitad del rango GLPI equivalente.
export function arandaUrgencyToGlpi(arandaUrgencyId) {
  const u = Number(arandaUrgencyId);
  if (u === 2) return 2;  // LOW       → GLPI Bajo
  if (u === 3) return 3;  // HIGH      → GLPI Mediano (preferimos el centro porque HIGH cubre 3 y 4)
  if (u === 4) return 5;  // CRITICAL  → GLPI Muy alto
  return null;
}

// --- PRIORITY (mapeo natural 1:1 sin pérdida) ---

// GLPI priority (1..5) → Aranda PriorityId (1..4)
export function glpiPriorityToAranda(glpiPriority) {
  const p = Number(glpiPriority);
  if (p <= 2) return 1;  // Muy bajo / Bajo  → LOW
  if (p === 3) return 2; // Mediano           → MEDIUM
  if (p === 4) return 3; // Alto              → HIGH
  if (p >= 5) return 4;  // Muy alto          → CRITICAL
  return null;
}

// Aranda PriorityId (1..4) → GLPI priority (1..5)
export function arandaPriorityToGlpi(arandaPriorityId) {
  const p = Number(arandaPriorityId);
  if (p === 1) return 2; // LOW       → GLPI Bajo
  if (p === 2) return 3; // MEDIUM    → GLPI Mediano
  if (p === 3) return 4; // HIGH      → GLPI Alto
  if (p === 4) return 5; // CRITICAL  → GLPI Muy alto
  return null;
}

// True si los valores ya están alineados entre ambos sistemas (evita pushes innecesarios).
export function urgencyMatches(glpiUrgency, arandaUrgencyId) {
  return glpiUrgencyToAranda(glpiUrgency) === Number(arandaUrgencyId);
}

export function priorityMatches(glpiPriority, arandaPriorityId) {
  return glpiPriorityToAranda(glpiPriority) === Number(arandaPriorityId);
}
