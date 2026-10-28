import { normalizarTexto } from './entrada';

/** Pantallas del sistema, con el mismo id que el menú. */
export type PantallaAyuda = 'caja' | 'inicio' | 'productos' | 'cierre' | 'clientes' | 'reportes' | 'ajustes';

/**
 * Un tema de la ayuda. En los textos, lo que va entre corchetes es una tecla: "[F12]" se ve como tecla.
 * `extra` pide algo vivo debajo de los pasos (probar el lector, la cámara o ver la guía de nuevo).
 */
export interface TemaAyuda {
  id: string;
  titulo: string;
  pantallas: PantallaAyuda[];
  soloDueño?: boolean;
  resumen: string;
  pasos: string[];
  consejos?: string[];
  /** Otras palabras con las que alguien lo buscaría. */
  palabras?: string;
  extra?: 'probarLector' | 'probarCamara' | 'guia';
}

export const TEMAS_AYUDA: TemaAyuda[] = [
  {
    id: 'cobrar',
    titulo: 'Cobrar una venta',
    pantallas: ['caja'],
    resumen: 'Lo de todos los días: pasar los productos, elegir cómo paga y cobrar.',
    pasos: [
      'Pasá el producto por el lector. Si no tiene código, escribí el nombre en el buscador y apretá [Enter], o tocá un botón rápido.',
      'Para sumar varios iguales, escribí la cantidad y un asterisco antes: [3*] y el código suma 3.',
      'Elegí cómo paga: Efectivo [F5], Mercado Pago [F6], Tarjeta [F7], Transferencia [F9] o Fiado [F10].',
      'En efectivo, escribí con cuánto paga en "Paga con" [F3] y el sistema te dice el vuelto.',
      'Tocá "Cobrar" o apretá [F12]. La venta queda guardada y el stock se descuenta solo.',
    ],
    consejos: [
      'Con el buscador vacío, [Enter] va a "Paga con" y otro [Enter] cobra justo, sin vuelto.',
      'Si te equivocaste, [Supr] saca lo último que pasaste.',
    ],
    palabras: 'vender venta cobro pagar vuelto efectivo mercado pago tarjeta transferencia',
  },
  {
    id: 'lector',
    titulo: 'Usar el lector de códigos de barras',
    pantallas: ['caja', 'productos'],
    resumen: 'El lector USB funciona como un teclado: no hay que instalar nada.',
    pasos: [
      'Enchufá el lector en un puerto USB de la compu. Si es inalámbrico, enchufá el receptor y apretá el gatillo una vez.',
      'Abrí la Caja. No hace falta hacer clic en ningún lado: lo que pasa el lector va solo al buscador.',
      'Pasá el producto con el código a unos 10 cm. Suena un pip y el producto aparece en la venta.',
      'Si dice "No encontré", ese código todavía no está cargado: tocá "Cargarlo" y queda guardado para la próxima.',
    ],
    consejos: [
      'Si el código aparece escrito pero el producto no se suma, el lector no manda [Enter] al final. En su manual buscá "Enter" o "CR" y escaneá ese código de configuración.',
      'Si salen símbolos en vez de números, el lector está configurado para otro teclado. En el manual buscá "Spanish" o "Latinoamérica" y escaneá ese código.',
      'También sirve en Productos (campo "Código de barras"), en "¿Cuánto sale?" y en "Llegó mercadería".',
      'Probalo acá abajo: pasá cualquier producto y te digo si lo leyó bien.',
    ],
    palabras: 'scanner escaner pistola usb codigo barras pip no lee no anda',
    extra: 'probarLector',
  },
  {
    id: 'camara',
    titulo: 'Leer códigos con la cámara del celular',
    pantallas: ['caja', 'productos'],
    resumen: 'Sin lector, la cámara del celular o de la compu lee el código.',
    pasos: [
      'En la Caja tocá el botón de la cámara, al lado del buscador. En Productos está al lado de "Código de barras".',
      'La primera vez el navegador pide permiso para usar la cámara: tocá "Permitir".',
      'Apuntá al código a un palmo de distancia y quedate quieto un segundo. Cuando lo lee, se cierra solo.',
    ],
    consejos: [
      'Anda en Chrome, en celulares Android y en compus con cámara. En iPhone todavía no: ahí usá el buscador o un lector Bluetooth.',
      'Si alguna vez tocaste "Bloquear": tocá el candado al lado de la dirección, entrá a Permisos y poné Cámara en "Permitir".',
      'Con poca luz cuesta más: acercá el producto a la luz o inclinalo para que no brille.',
    ],
    palabras: 'camara celular foto escanear permiso iphone android',
    extra: 'probarCamara',
  },
  {
    id: 'otroCodigo',
    titulo: 'El lector dice que no está, pero ya lo tengo cargado',
    pantallas: ['caja', 'productos'],
    resumen: 'El mismo producto con otro código (otra caja, otro proveedor).',
    pasos: [
      'Cuando aparece "Este código no está cargado", tocá "Ya lo tengo cargado".',
      'Escribí parte del nombre y tocá el producto.',
      'El código nuevo queda guardado en ese producto: la próxima vez lo reconoce solo y se suma a la venta.',
    ],
    consejos: ['En Productos, al editar el producto, ves todos sus códigos y podés quitar uno con la cruz.'],
    palabras: 'codigo distinto otro codigo no encuentra repetido duplicado mismo producto',
  },
  {
    id: 'repetir',
    titulo: 'Repetir lo que lleva siempre un cliente',
    pantallas: ['caja', 'clientes'],
    resumen: 'Para el que fía y lleva lo mismo de siempre.',
    pasos: [
      'Con la venta vacía, elegí Fiado [F10] y el cliente.',
      'Tocá "Repetir lo de la última vez": se cargan sus productos con el precio de hoy.',
      'Sacá o sumá lo que haga falta y tocá "Anotar".',
    ],
    palabras: 'repetir lo de siempre ultima compra igual cliente',
  },
  {
    id: 'consultar',
    titulo: 'Ver cuánto sale algo sin venderlo',
    pantallas: ['caja'],
    resumen: 'Para cuando un cliente pregunta el precio.',
    pasos: [
      'Tocá "¿Cuánto sale?" al lado del buscador, o escribí [?] y después pasá el producto o escribí el nombre.',
      'Se abre "¿Cuánto sale?" con el precio y el stock. No se suma a la venta.',
    ],
    palabras: 'precio consultar cuanto sale stock cuantos quedan',
  },
  {
    id: 'corregir',
    titulo: 'Sacar o cambiar algo de la venta',
    pantallas: ['caja'],
    resumen: 'Antes de cobrar todo se puede corregir.',
    pasos: [
      '[Supr] saca lo último que pasaste.',
      'En la lista, con [−] y [+] cambiás la cantidad. El tacho lo saca.',
      'Si ya cobraste, en la última venta tenés "Anular" (pide dos toques; al empleado le pide la clave del dueño).',
    ],
    palabras: 'error equivoque borrar sacar quitar anular cancelar',
  },
  {
    id: 'espera',
    titulo: 'Atender a otro mientras uno busca la plata',
    pantallas: ['caja'],
    resumen: 'Dejás una venta guardada y seguís con el próximo.',
    pasos: [
      'Con la venta armada, apretá [F8] o tocá "Dejar en espera".',
      'Atendé al siguiente normalmente.',
      'Para seguir con la primera, tocá "Cliente 1" arriba de la lista.',
    ],
    palabras: 'espera pausa guardar venta otro cliente',
  },
  {
    id: 'libre',
    titulo: 'Cobrar algo que no está cargado',
    pantallas: ['caja'],
    resumen: 'Un monto suelto, sin producto.',
    pasos: ['Apretá [F4] o tocá "Monto libre", al lado del buscador.', 'Escribí el monto y, si querés, qué es. Se suma a la venta.'],
    palabras: 'monto libre varios sin codigo suelto',
  },
  {
    id: 'descuento',
    titulo: 'Hacer un descuento o redondear',
    pantallas: ['caja'],
    resumen: 'Sobre toda la venta.',
    pasos: [
      'Con la venta armada, tocá "Descuento", debajo del total.',
      'Elegí cómo descontar (porcentaje o monto) o redondeá: "son 3.150, dejámelo en 3.000".',
    ],
    consejos: ['El empleado puede descontar hasta el 10 %. Más que eso lo autoriza el dueño con su clave.'],
    palabras: 'descuento rebaja redondeo porcentaje',
  },
  {
    id: 'dividir',
    titulo: 'Pagar con dos medios',
    pantallas: ['caja'],
    resumen: 'Por ejemplo, una parte en efectivo y otra con Mercado Pago.',
    pasos: ['Con la venta armada, tocá "Dividir pago".', 'Poné cuánto va por cada medio y cobrá.'],
    palabras: 'dividir dos medios mitad parte',
  },
  {
    id: 'fiado',
    titulo: 'Anotar una venta al fiado',
    pantallas: ['caja', 'clientes'],
    resumen: 'La venta queda en la cuenta del cliente.',
    pasos: [
      'Armá la venta y elegí Fiado [F10].',
      'Elegí el cliente. Si es nuevo, escribí el nombre y tocá "Crear cliente".',
      'Tocá "Anotar". Queda en su cuenta, en Clientes y fiado.',
    ],
    consejos: ['Si el cliente pasa su límite, el empleado necesita la clave del dueño.'],
    palabras: 'fiado cuenta corriente deber anotar libreta',
  },
  {
    id: 'cobrarFiado',
    titulo: 'Cobrar un fiado',
    pantallas: ['caja', 'clientes'],
    resumen: 'Cuando un cliente viene a pagar lo que debe.',
    pasos: [
      'En la Caja tocá "Cobrar un fiado" (en el celular está en la caja vacía; en la compu, abajo).',
      'Elegí el cliente, poné cuánto paga y cómo.',
      'Si paga de más, le queda saldo a favor para la próxima.',
    ],
    palabras: 'cobrar fiado pago deuda saldo',
  },
  {
    id: 'movimiento',
    titulo: 'Sacar plata de la caja o anotar un gasto',
    pantallas: ['caja', 'cierre'],
    resumen: 'Para que el cierre cierre.',
    pasos: [
      'Tocá "Retiro o gasto".',
      'Elegí qué es (retiro, gasto o ingreso), poné el monto y un detalle.',
      'Se descuenta del efectivo que debería haber al cerrar.',
    ],
    consejos: ['El empleado necesita la clave del dueño para retiros y gastos.'],
    palabras: 'retiro gasto ingreso sacar plata pagar proveedor',
  },
  {
    id: 'mercaderia',
    titulo: 'Anotar que llegó mercadería',
    pantallas: ['caja', 'productos'],
    resumen: 'Suma stock y, si cambió el costo, ajusta el precio.',
    pasos: [
      'Tocá "Llegó mercadería".',
      'Pasá cada producto por el lector (o buscalo) y poné cuántos llegaron y a qué costo.',
      'Si el costo subió, el sistema te propone el precio nuevo manteniendo tu ganancia.',
      'Si lo pagaste con plata de la caja, tildalo: se anota como gasto del turno.',
    ],
    palabras: 'mercaderia proveedor llego compra stock reponer',
  },
  {
    id: 'devolver',
    titulo: 'Devolver o cambiar un producto',
    pantallas: ['caja', 'cierre'],
    resumen: 'El stock vuelve y la plata sale de la caja o vuelve a la cuenta.',
    pasos: [
      'En la última venta, tocá "Devolver". Para otra venta del turno, buscala en Cierre de caja.',
      'Elegí qué productos y cuántos vuelven.',
      'Elegí cómo devolvés la plata. Para un cambio, devolvé y cobrá lo nuevo como una venta.',
    ],
    consejos: ['Para una venta de otro día, abrí ese cierre en "Cierres anteriores" (pide la clave del dueño).'],
    palabras: 'devolucion devolver cambio cambiar vencido fallado',
  },
  {
    id: 'ticket',
    titulo: 'Imprimir el ticket',
    pantallas: ['caja', 'ajustes'],
    resumen: 'El comprobante para el cliente. No es factura.',
    pasos: [
      'Después de cobrar, tocá "Ticket" en la última venta.',
      'Para que salga solo cada vez que cobrás, en Ajustes tildá "Imprimir el ticket solo".',
      'En Ajustes también ponés el encabezado (nombre, dirección) y el mensaje al pie.',
    ],
    palabras: 'ticket imprimir impresora comprobante termica',
  },
  {
    id: 'abrir',
    titulo: 'Abrir la caja',
    pantallas: ['caja'],
    resumen: 'Al empezar el turno.',
    pasos: ['Entrá a la Caja.', 'Poné cuánto cambio hay en la caja y tocá "Abrir caja".'],
    palabras: 'abrir caja empezar turno cambio inicial',
  },
  {
    id: 'cerrar',
    titulo: 'Cerrar la caja al final del turno',
    pantallas: ['cierre'],
    resumen: 'Contás la plata y el sistema te dice si falta o sobra.',
    pasos: [
      'Entrá a Cierre de caja.',
      'Contá los billetes: poné cuántos hay de cada uno y la cuenta se hace sola.',
      'Revisá la diferencia contra lo que debería haber y confirmá.',
    ],
    consejos: [
      'El empleado cuenta "a ciegas": ve la diferencia recién al confirmar. Así se cuenta de verdad.',
      'Si cambia el turno, usá "Cerrar y pasarle la caja a otro": cierra y le abre la caja al que sigue.',
    ],
    palabras: 'cierre cerrar caja contar billetes arqueo diferencia falta sobra turno',
  },
  {
    id: 'producto',
    titulo: 'Cargar un producto nuevo',
    pantallas: ['productos'],
    soloDueño: true,
    resumen: 'Nombre, código, precio y stock.',
    pasos: [
      'En Productos tocá "Nuevo producto".',
      'Con el cursor en "Código de barras", pasá el producto por el lector (o tocá la cámara).',
      'Poné nombre, precio, costo y cuántos tenés. En "Avisar cuando queden" va el mínimo.',
      'Tildá "Botón rápido en la caja" para lo que más sale: aparece como botón para cobrarlo con un toque.',
    ],
    consejos: [
      'Para fiambre o golosinas sueltas, tildá "Se vende por peso": en la caja pide los gramos.',
      'Las promos tipo "3 x $1000" se cargan en "Promo: llevando".',
    ],
    palabras: 'producto nuevo cargar alta articulo precio costo stock minimo boton rapido peso promo',
  },
  {
    id: 'planilla',
    titulo: 'Cargar muchos productos de una vez',
    pantallas: ['productos'],
    soloDueño: true,
    resumen: 'Desde una planilla de Excel.',
    pasos: [
      'En Productos tocá "Descargar planilla" para tener el modelo.',
      'Completala en Excel y guardala con "Guardar como → CSV".',
      'Tocá "Cargar una lista" y elegí ese archivo. Antes de guardar te muestra qué va a cambiar.',
    ],
    consejos: ['Los productos que ya tenés (mismo código) se actualizan; el stock que ya cargaste no se pisa.'],
    palabras: 'excel planilla csv importar lista masivo',
  },
  {
    id: 'aumento',
    titulo: 'Aumentar precios',
    pantallas: ['productos'],
    soloDueño: true,
    resumen: 'Subir un porcentaje a todo, a una categoría o a un proveedor.',
    pasos: [
      'En Productos tocá "Aumentar precios".',
      'Elegí a qué productos y el porcentaje. Podés redondear.',
      'Mirá cómo quedan antes de confirmar.',
    ],
    consejos: ['Dejá tildado "Subir también el costo" para que la ganancia de los reportes quede bien.'],
    palabras: 'aumento aumentar precios inflacion porcentaje actualizar',
  },
  {
    id: 'listaPrecios',
    titulo: 'Imprimir la lista de precios o etiquetas',
    pantallas: ['productos'],
    soloDueño: true,
    resumen: 'Para la góndola o el mostrador.',
    pasos: ['En Productos tocá "Lista de precios".', 'Elegí qué productos y si querés lista o etiquetas, y tocá "Imprimir".'],
    palabras: 'lista precios etiquetas gondola imprimir cartel',
  },
  {
    id: 'pedido',
    titulo: 'Armar el pedido al proveedor',
    pantallas: ['productos'],
    soloDueño: true,
    resumen: 'El sistema sugiere qué y cuánto pedir.',
    pasos: [
      'En Productos tocá "Pedido al proveedor".',
      'Aparecen los productos por debajo del mínimo, con la cantidad sugerida.',
      'Ajustá lo que quieras y mandalo por WhatsApp o copialo.',
    ],
    palabras: 'pedido proveedor reponer faltante minimo whatsapp',
  },
  {
    id: 'clientes',
    titulo: 'Ver lo que debe cada cliente',
    pantallas: ['clientes'],
    soloDueño: true,
    resumen: 'La libreta del fiado, ordenada.',
    pasos: [
      'En Clientes y fiado elegí un cliente: ves su saldo y cada compra.',
      'Con "Recordarle por WhatsApp" le mandás lo que debe (cargale el número antes).',
      'Al crear o editar el cliente podés ponerle un límite de fiado.',
    ],
    palabras: 'clientes deuda saldo libreta whatsapp limite',
  },
  {
    id: 'avisar',
    titulo: 'Avisarles a todos los que deben',
    pantallas: ['clientes'],
    soloDueño: true,
    resumen: 'Un mensaje de WhatsApp a cada uno, ya escrito.',
    pasos: [
      'En Clientes y fiado tocá "Avisar a los que deben hace más de una semana".',
      'Tocá "Mandar" en cada uno: se abre WhatsApp con el saldo escrito. Envialo y volvé para el siguiente.',
      'Los que ya avisaste hoy quedan marcados en verde.',
    ],
    consejos: ['Si a alguno le falta el número, tocá "Cargar WhatsApp".'],
    palabras: 'whatsapp avisar recordar deudores cobrar mensaje todos',
  },
  {
    id: 'mercadopago',
    titulo: 'Controlar lo cobrado por Mercado Pago',
    pantallas: ['cierre'],
    resumen: 'Que lo anotado coincida con la app.',
    pasos: [
      'En Cierre de caja, buscá "Controlar Mercado Pago".',
      'En la app de Mercado Pago, mirá la actividad de hoy desde que abriste la caja y poné el total.',
      'El sistema te dice si coincide o cuánto falta o sobra, y te muestra cada cobro con su hora para encontrar cuál fue.',
    ],
    palabras: 'mercado pago mp qr app conciliar controlar comparar transferencia',
  },
  {
    id: 'panel',
    titulo: 'Qué muestra el Panel del día',
    pantallas: ['inicio'],
    soloDueño: true,
    resumen: 'Cómo viene el día de un vistazo.',
    pasos: [
      'Arriba: lo vendido, la ganancia estimada y el efectivo que debería haber.',
      'En "Para atender": lo que se está por acabar, lo que vence y quién debe.',
      'Abajo: los últimos 7 días, para comparar.',
    ],
    palabras: 'panel inicio resumen dia hoy',
  },
  {
    id: 'reportes',
    titulo: 'Entender los reportes',
    pantallas: ['reportes'],
    soloDueño: true,
    resumen: 'Ventas, ganancia y qué se mueve.',
    pasos: [
      'Elegí el período arriba: hoy, ayer, 7 días, 30 días, este mes o un día puntual.',
      'La "Ganancia estimada" es precio menos costo de lo vendido. Para que sea real, cargá el costo de cada producto.',
      'En "Gastos del local" anotá luz, alquiler y sueldos: te muestra lo que queda después.',
      'Abajo ves lo que más se vendió, las horas pico y lo que no se vende hace 30 días.',
    ],
    palabras: 'reportes ganancia estadisticas ventas mes semana gastos',
  },
  {
    id: 'usuarios',
    titulo: 'Sumar un empleado',
    pantallas: ['ajustes'],
    soloDueño: true,
    resumen: 'Cada uno entra con su usuario y queda registrado quién cobró.',
    pasos: [
      'En Ajustes, en Usuarios, tocá "Sumar un usuario".',
      'Poné nombre, usuario y clave. Dejá sin tildar "Es dueño".',
      'El empleado sólo ve la Caja, el Cierre y Ajustes. Anular, retiros y descuentos grandes le piden tu clave.',
    ],
    palabras: 'empleado usuario clave permisos dueño',
  },
  {
    id: 'equipos',
    titulo: 'Usarlo en otra compu o en el celular',
    pantallas: ['ajustes'],
    resumen: 'Todos los equipos ven lo mismo.',
    pasos: [
      'Abrí milenio-market.vercel.app en el otro equipo.',
      'Entrá con el mismo usuario y clave. Los productos, clientes y ventas se traen solos.',
      'Abajo a la izquierda (o en "Más", en el celular) dice "Nube al día" cuando todo está subido.',
    ],
    consejos: ['En el celular, desde el menú de Chrome tocá "Agregar a pantalla principal" y queda como una aplicación.'],
    palabras: 'celular otra compu nube sincronizar instalar aplicacion',
  },
  {
    id: 'internet',
    titulo: '¿Y si se corta internet?',
    pantallas: ['caja', 'ajustes'],
    resumen: 'Seguís cobrando normal.',
    pasos: [
      'Todo queda guardado en la compu aunque no haya internet.',
      'Cuando vuelve, se sube solo a la nube. No tenés que hacer nada.',
    ],
    palabras: 'internet sin conexion wifi offline corte',
  },
  {
    id: 'copia',
    titulo: 'Guardar una copia de seguridad',
    pantallas: ['ajustes'],
    soloDueño: true,
    resumen: 'Por si la compu se rompe.',
    pasos: ['En Ajustes, en "Copia de seguridad", descargá la copia.', 'Guardala en un pendrive o mandátela por mail.'],
    consejos: ['Con la nube activa ya tenés todo guardado; la copia es un respaldo extra.'],
    palabras: 'copia seguridad respaldo backup restaurar',
  },
  {
    id: 'visor',
    titulo: 'Mostrarle la venta al cliente en otra pantalla',
    pantallas: ['ajustes'],
    resumen: 'Un segundo monitor mirando al mostrador.',
    pasos: [
      'En Ajustes tocá "Abrir la pantalla para el cliente".',
      'Arrastrá esa ventana al segundo monitor. El cliente ve lo que lleva, el total y el vuelto.',
    ],
    palabras: 'visor pantalla cliente monitor',
  },
  {
    id: 'clave',
    titulo: 'Me olvidé la clave',
    pantallas: ['ajustes'],
    resumen: 'Hay salida.',
    pasos: [
      'Si estás adentro en algún equipo, cambiala en Ajustes → "Cambiar mi clave". Sirve en todos lados.',
      'Si no, en la pantalla de entrada tocá "¿Te olvidaste el usuario o la clave?".',
      'Un empleado que se olvidó la clave: el dueño se la cambia en Ajustes → Usuarios.',
    ],
    palabras: 'clave contraseña olvide usuario entrar',
  },
  {
    id: 'teclas',
    titulo: 'Todas las teclas rápidas',
    pantallas: ['caja'],
    resumen: 'Para cobrar sin tocar el mouse.',
    pasos: [
      '[F1] abre esta ayuda.',
      '[F2] va al buscador. [F3] va a "Paga con".',
      '[F4] monto libre. [F8] deja la venta en espera.',
      '[F5] Efectivo, [F6] Mercado Pago, [F7] Tarjeta, [F9] Transferencia, [F10] Fiado.',
      '[F12] cobra.',
      '[3*] antes del código suma 3. [?] antes del producto consulta el precio. [Supr] saca lo último.',
    ],
    palabras: 'teclas atajos teclado f12 rapido',
  },
  {
    id: 'guia',
    titulo: 'Ver de nuevo la guía de primer uso',
    pantallas: [],
    resumen: 'Los pasos de bienvenida, en un minuto.',
    pasos: [],
    palabras: 'guia tutorial bienvenida empezar primeros pasos',
    extra: 'guia',
  },
];

/** Lo que ve cada uno: el empleado no ve temas de pantallas a las que no entra. */
export function temasVisibles(dueño: boolean): TemaAyuda[] {
  return TEMAS_AYUDA.filter((t) => dueño || !t.soloDueño);
}

/**
 * Busca por palabras sueltas, sin tildes ni mayúsculas: "como cierro" encuentra "Cerrar la caja".
 * Cada palabra suma si aparece: en el título, 3; en las palabras clave, 2; en el resto, 1. Sin búsqueda, devuelve los de la pantalla primero.
 */
export function buscarAyuda(q: string, pantalla: PantallaAyuda, dueño: boolean): TemaAyuda[] {
  const temas = temasVisibles(dueño);
  const palabras = normalizarTexto(q)
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(' ')
    .filter((p) => p.length >= 3 && !VACIAS.has(p));
  if (palabras.length === 0) {
    return [...temas.filter((t) => t.pantallas.includes(pantalla)), ...temas.filter((t) => !t.pantallas.includes(pantalla))];
  }
  const puntaje = (t: TemaAyuda) => {
    const titulo = normalizarTexto(t.titulo);
    const claves = normalizarTexto(t.palabras ?? '');
    const resto = normalizarTexto(`${t.resumen} ${t.pasos.join(' ')} ${(t.consejos ?? []).join(' ')}`);
    let total = 0;
    for (const p of palabras) {
      // "cierro" tiene que encontrar "cierre": se compara la raíz de la palabra.
      const raiz = p.length > 5 ? p.slice(0, p.length - 2) : p;
      if (titulo.includes(raiz)) total += 3;
      else if (claves.includes(raiz)) total += 2;
      else if (resto.includes(raiz)) total += 1;
    }
    return total + (t.pantallas.includes(pantalla) ? 0.5 : 0);
  };
  const conPuntaje = temas.map((t) => ({ t, p: puntaje(t) })).sort((a, b) => b.p - a.p);
  // Lo que apenas roza la búsqueda ("caja" aparece en casi todo) no se muestra si hay algo mucho mejor.
  const piso = Math.max(1, (conPuntaje[0]?.p ?? 0) * 0.4);
  return conPuntaje.filter((x) => x.p >= piso).map((x) => x.t);
}

const VACIAS = new Set(['como', 'hago', 'para', 'que', 'una', 'uno', 'los', 'las', 'del', 'con', 'por', 'quiero', 'puedo', 'donde', 'esta', 'este']);

/** Parte un texto de ayuda en pedazos de texto y de teclas ("[F12]"). */
export function partesConTeclas(texto: string): { tecla: boolean; texto: string }[] {
  return texto
    .split(/(\[[^\]]+\])/)
    .filter(Boolean)
    .map((p) => (p.startsWith('[') && p.endsWith(']') ? { tecla: true, texto: p.slice(1, -1) } : { tecla: false, texto: p }));
}

/** Un paso de la guía de primer uso. */
export interface PasoGuia {
  titulo: string;
  texto: string;
  icono: 'caja' | 'camara' | 'productos' | 'cierre' | 'clientes' | 'reportes' | 'ayuda';
}

export function pasosGuia(dueño: boolean): PasoGuia[] {
  const pasos: PasoGuia[] = [
    {
      titulo: 'Cobrar es pasar, elegir y cobrar',
      texto: 'Pasá los productos por el lector, elegí cómo paga y tocá "Cobrar". El stock se descuenta solo.',
      icono: 'caja',
    },
    {
      titulo: 'El lector o la cámara',
      texto: 'Enchufá el lector USB y listo: no hay que hacer clic en ningún lado. En el celular, el botón de la cámara lee el código.',
      icono: 'camara',
    },
  ];
  if (dueño) {
    pasos.push(
      {
        titulo: 'Tus productos',
        texto: 'En Productos cargás cada uno con el lector, o muchos de una vez desde Excel. Los que más salen, como botón rápido.',
        icono: 'productos',
      },
      {
        titulo: 'Fiado y reportes',
        texto: 'Clientes y fiado es tu libreta, con aviso por WhatsApp. En el Panel y en Reportes ves cuánto vendés y cuánto ganás.',
        icono: 'reportes',
      },
    );
  }
  pasos.push(
    {
      titulo: 'Al terminar el turno',
      texto: 'En Cierre de caja contás los billetes y el sistema te dice si falta o sobra.',
      icono: 'cierre',
    },
    {
      titulo: 'Si tenés una duda',
      texto: 'Tocá "Ayuda" en el menú (en el celular, el signo de pregunta de arriba). Te explica lo de la pantalla en la que estás y podés buscar lo que necesites.',
      icono: 'ayuda',
    },
  );
  return pasos;
}
