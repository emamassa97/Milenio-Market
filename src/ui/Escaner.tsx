import { useEffect, useRef, useState } from 'react';
import { Modal } from './componentes';

interface Detector {
  detect(fuente: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type ConstructorDetector = new (opciones: { formats: string[] }) => Detector;

export function camaraDisponible(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
}

/** Lee códigos de barras con la cámara (celular o compu). */
export function Escaner({ onCodigo, onCerrar }: { onCodigo: (codigo: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(
    camaraDisponible() ? null : 'Este navegador no lee códigos con la cámara. Usá Chrome en un celular Android o el lector USB.',
  );

  useEffect(() => {
    if (!camaraDisponible()) return;
    let corriendo = true;
    let flujo: MediaStream | null = null;
    const Clase = (window as unknown as { BarcodeDetector: ConstructorDetector }).BarcodeDetector;
    const detector = new Clase({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!corriendo || !video.current) return;
        video.current.srcObject = flujo;
        await video.current.play();
        const buscar = async () => {
          if (!corriendo || !video.current) return;
          try {
            const hallados = await detector.detect(video.current);
            const codigo = hallados[0]?.rawValue;
            if (codigo) {
              corriendo = false;
              onCodigo(codigo);
              return;
            }
          } catch {
            /* cuadro sin imagen todavía */
          }
          window.setTimeout(buscar, 150);
        };
        buscar();
      } catch {
        setError('No se pudo abrir la cámara. Revisá que el navegador tenga permiso para usarla.');
      }
    })();
    return () => {
      corriendo = false;
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, [onCodigo]);

  return (
    <Modal titulo="Escanear con la cámara" onCerrar={onCerrar}>
      {error ? (
        <p className="texto-suave">{error}</p>
      ) : (
        <div className="escaner">
          <video ref={video} muted playsInline />
          <div className="escaner-guia" aria-hidden="true" />
          <p className="texto-suave">Apuntá al código de barras y quedate quieto un segundo.</p>
        </div>
      )}
    </Modal>
  );
}
