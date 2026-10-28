import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Si una pantalla falla al dibujarse, en vez de quedar en blanco se explica qué hacer. La venta armada está
 * guardada en el equipo, así que recargar no la pierde.
 */
export class BordeDeError extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('La pantalla falló al dibujarse', error, info.componentStack);
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <div className="borde-error" role="alert">
        <div className="tarjeta formulario">
          <h1>Algo se trabó en esta pantalla</h1>
          <p>La venta que estabas armando no se pierde: está guardada en este equipo. Recargá y seguí desde donde estabas.</p>
          <button type="button" className="boton boton-primario boton-grande" onClick={() => location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
