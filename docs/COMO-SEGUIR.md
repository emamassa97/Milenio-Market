# Cómo poner en marcha la copia en la nube

La caja funciona siempre con los datos guardados en el equipo (sin internet también).
La copia en la nube es un respaldo: cada minuto, si hay internet, el equipo sube a
Neon lo que cambió. Nunca baja datos solo.

## Una sola vez, en Vercel

1. En el proyecto **milenio-market** → **Storage** → **Create Database** → **Neon**,
   y conectarla al proyecto. Eso crea la variable `DATABASE_URL` (o `POSTGRES_URL`).
2. En **Settings → Environment Variables**, crear `SYNC_CLAVE` con una clave larga
   (es la que se escribe en la caja).
3. Volver a publicar. La tabla `registros` se crea sola con el primer envío.

## En la caja

**Ajustes → Copia en la nube** → escribir la clave → **Activar**. Arriba, en la barra,
aparece "Nube al día" o "Nube: revisar" si algo falló.

## Si se rompe la compu

En el equipo nuevo, sin cargar nada: **Ajustes → Copia en la nube** → clave →
**Recuperar desde la nube**. Trae lo del último equipo que subió datos.

## Qué se guarda en Neon

Una tabla `registros(dispositivo, tabla, id, datos jsonb, borrado, actualizado)`:
una fila por producto, venta, turno, movimiento, cliente o ajuste. Lo borrado queda
marcado con `borrado = true`. Los ajustes propios del equipo (la clave, las marcas
de sincronización) no se suben.
