import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Una pantalla que se baja cuando se usa (React.lazy). Si no se puede bajar porque mientras tanto se publicó
 * una versión nueva (el archivo viejo ya no existe), recarga una vez: el carrito y las ventas en espera
 * sobreviven a recargar, así que no se pierde nada.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Componente = ComponentType<any>;

export function cargarAparte<M, K extends keyof M>(importar: () => Promise<M>, nombre: K): LazyExoticComponent<M[K] extends Componente ? M[K] : never> {
  return lazy(async () => {
    try {
      const m = await importar();
      sessionStorage.removeItem('milenio.recargaPorVersion');
      return { default: m[nombre] as M[K] extends Componente ? M[K] : never };
    } catch (e) {
      let yaRecargo = false;
      try {
        yaRecargo = sessionStorage.getItem('milenio.recargaPorVersion') === '1';
        sessionStorage.setItem('milenio.recargaPorVersion', '1');
      } catch {
        yaRecargo = true;
      }
      if (yaRecargo) throw e;
      window.location.reload();
      return new Promise<never>(() => {});
    }
  });
}
