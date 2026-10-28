import { describe, expect, it } from 'vitest';
import { TEMAS_AYUDA, buscarAyuda, partesConTeclas, pasosGuia } from './ayuda';

describe('ayuda', () => {
  it('sin búsqueda muestra primero lo de la pantalla en la que está', () => {
    const temas = buscarAyuda('', 'cierre', true);
    expect(temas[0]!.pantallas).toContain('cierre');
    expect(temas).toHaveLength(TEMAS_AYUDA.length);
  });

  it('encuentra como lo pregunta la gente, sin tildes ni la palabra exacta', () => {
    expect(buscarAyuda('¿cómo cierro la caja?', 'caja', true)[0]!.id).toBe('cerrar');
    expect(buscarAyuda('el lector no anda', 'caja', true)[0]!.id).toBe('lector');
    expect(buscarAyuda('camara del celular', 'caja', true)[0]!.id).toBe('camara');
    expect(buscarAyuda('fiado', 'caja', true).map((t) => t.id)).toContain('cobrarFiado');
    expect(buscarAyuda('excel', 'productos', true)[0]!.id).toBe('planilla');
    expect(buscarAyuda('me olvidé la contraseña', 'ajustes', true)[0]!.id).toBe('clave');
    expect(buscarAyuda('xyzzy', 'caja', true)).toEqual([]);
  });

  it('el empleado no ve temas de pantallas a las que no entra', () => {
    const ids = buscarAyuda('', 'caja', false).map((t) => t.id);
    expect(ids).not.toContain('producto');
    expect(ids).not.toContain('reportes');
    expect(ids).toContain('lector');
    expect(ids).toContain('cerrar');
    expect(buscarAyuda('excel', 'caja', false)).toEqual([]);
  });

  it('dibuja las teclas que van entre corchetes', () => {
    expect(partesConTeclas('Apretá [F12] y listo')).toEqual([
      { tecla: false, texto: 'Apretá ' },
      { tecla: true, texto: 'F12' },
      { tecla: false, texto: ' y listo' },
    ]);
  });

  it('la guía del empleado es más corta y las dos terminan en la ayuda', () => {
    expect(pasosGuia(false).length).toBeLessThan(pasosGuia(true).length);
    expect(pasosGuia(true).at(-1)!.icono).toBe('ayuda');
    expect(pasosGuia(false).at(-1)!.icono).toBe('ayuda');
  });

  it('los ids no se repiten', () => {
    expect(new Set(TEMAS_AYUDA.map((t) => t.id)).size).toBe(TEMAS_AYUDA.length);
  });
});
