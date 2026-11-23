import { describe, expect, it } from 'vitest';
import { AL_VOLVER_CADA, BAJAR_CADA, SUBIR_CADA, tocaSincronizar } from './nube';

describe('cada cuánto se habla con la nube', () => {
  const t0 = 1_000_000_000;

  it('la primera vez va en el momento', () => {
    expect(tocaSincronizar(t0, null, false)).toBe(true);
    expect(tocaSincronizar(t0, null, true)).toBe(true);
  });

  it('con ventas nuevas sube cada 10 minutos, no cada medio minuto', () => {
    expect(tocaSincronizar(t0 + 30_000, t0, true)).toBe(false);
    expect(tocaSincronizar(t0 + SUBIR_CADA - 1, t0, true)).toBe(false);
    expect(tocaSincronizar(t0 + SUBIR_CADA, t0, true)).toBe(true);
  });

  it('sin nada nuevo sólo baja cada media hora', () => {
    expect(tocaSincronizar(t0 + SUBIR_CADA, t0, false)).toBe(false);
    expect(tocaSincronizar(t0 + BAJAR_CADA, t0, false)).toBe(true);
  });

  it('deja dormir la base: entre vueltas pasan más de los 5 minutos en que se apaga', () => {
    expect(SUBIR_CADA).toBeGreaterThan(5 * 60_000);
    expect(BAJAR_CADA).toBeGreaterThan(SUBIR_CADA);
    expect(AL_VOLVER_CADA).toBeLessThan(SUBIR_CADA);
  });
});
