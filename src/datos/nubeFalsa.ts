// Postgres falso en memoria que entiende las consultas de servidor/sincronizar.ts (sólo para las pruebas).
import { manejar, type Consulta } from '../../servidor/sincronizar';

export interface FilaV2 { tabla: string; id: string; datos: any; borrado: boolean; equipo: number; seq: number }
export interface Fila { dispositivo: string; tabla: string; id: string; datos: any; borrado: boolean; actualizado: number }

export function crearNube() {
  const filas = new Map<string, Fila>();
  const config = new Map<string, string>();
  const intentos = new Map<string, { fallos: number; hasta: number | null }>();
  let reloj = 1;
  const v2 = new Map<string, FilaV2>();
  const equipos = new Map<string, number>();
  let seq = 0;
  const ahora = () => Date.now();
  const k = (d: string, t: string, i: string) => `${d}\u0000${t}\u0000${i}`;
  const ultimoDispositivo = () => {
    const max = new Map<string, number>();
    for (const f of filas.values()) max.set(f.dispositivo, Math.max(max.get(f.dispositivo) ?? 0, f.actualizado));
    return [...max.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  };
  const consulta: Consulta = async (texto, p) => {
    const t = texto.replace(/\s+/g, ' ');
    if (t.startsWith('create ')) return [];
    if (t.includes("from filas where tabla = 'ajustes' and id = 'usuarios'")) {
      const f = v2.get(`ajustes\u0000usuarios`);
      return f && !f.borrado ? [{ datos: f.datos }] : [];
    }
    if (t.includes('insert into equipos')) {
      const d = p[0] as string;
      if (!equipos.has(d)) equipos.set(d, equipos.size + 1);
      return [{ n: equipos.get(d) }];
    }
    if (t.includes('insert into filas')) {
      const [equipo, json] = p as [number, string];
      for (const r of JSON.parse(json)) {
        const k2 = `${r.tabla}\u0000${r.id}`;
        const previa = v2.get(k2);
        if (previa && !previa.borrado && previa.datos?._o === r.datos?._o) continue;
        let datos = r.datos;
        if (previa && !previa.borrado && r.tabla === 'productos' && typeof datos._s === 'number' && typeof datos.stock === 'number' && typeof previa.datos?.stock === 'number') {
          datos = { ...datos, stock: Math.round((previa.datos.stock + datos.stock - datos._s) * 1000) / 1000 };
        }
        v2.set(k2, { tabla: r.tabla, id: r.id, datos, borrado: false, equipo, seq: ++seq });
      }
      return [];
    }
    if (t.includes('update filas set borrado')) {
      for (const r of JSON.parse(p[0] as string)) {
        const f = v2.get(`${r.tabla}\u0000${r.id}`);
        if (f && !f.borrado) { f.borrado = true; f.seq = ++seq; }
      }
      return [];
    }
    if (t.includes('from filas where seq >')) {
      return [...v2.values()].filter((f) => f.seq > (p[0] as number)).sort((a, b) => a.seq - b.seq).slice(0, 1000)
        .map((f) => ({ tabla: f.tabla, id: f.id, datos: f.datos, borrado: f.borrado, seq: f.seq }));
    }
    if (t.includes('insert into config_nube')) {
      if (config.has('clave')) return [];
      config.set('clave', p[0] as string);
      return [{ valor: p[0] }];
    }
    if (t.includes('from config_nube')) return config.has('clave') ? [{ valor: config.get('clave') }] : [];
    if (t.includes('select 1 from intentos_ingreso')) {
      const i = intentos.get(p[0] as string);
      return i && i.hasta !== null && i.hasta > ahora() ? [{ '?column?': 1 }] : [];
    }
    if (t.includes('insert into intentos_ingreso')) {
      const [u, max, mins] = p as [string, number, number];
      const i = intentos.get(u);
      if (!i) intentos.set(u, { fallos: 1, hasta: null });
      else if (i.fallos + 1 >= max) intentos.set(u, { fallos: 0, hasta: ahora() + mins * 60_000 });
      else intentos.set(u, { fallos: i.fallos + 1, hasta: i.hasta });
      return [];
    }
    if (t.includes('delete from intentos_ingreso')) { intentos.delete(p[0] as string); return []; }
    if (t.includes("where tabla = 'ajustes' and id = 'usuarios'")) {
      const c = [...filas.values()].filter((f) => f.tabla === 'ajustes' && f.id === 'usuarios' && !f.borrado);
      c.sort((a, b) => Number(b.datos?._v ?? 0) - Number(a.datos?._v ?? 0) || b.actualizado - a.actualizado);
      return c.slice(0, 1).map((f) => ({ datos: f.datos }));
    }
    if (t.includes('count(distinct dispositivo)') || t.includes('greatest(')) return [{ n: new Set([...filas.values()].map((f) => f.dispositivo)).size }];
    if (t.includes('group by dispositivo order by max(actualizado) desc limit 1')) {
      const d = ultimoDispositivo()[0];
      return d ? [{ dispositivo: d }] : [];
    }
    if (t.includes('count(*) filter')) {
      return ultimoDispositivo().map((d) => {
        const fs = [...filas.values()].filter((f) => f.dispositivo === d);
        return { dispositivo: d, registros: fs.filter((f) => !f.borrado).length, ultima: new Date(Math.max(...fs.map((f) => f.actualizado))) };
      });
    }
    if (t.includes('insert into registros')) {
      const [d, json] = p as [string, string];
      for (const r of JSON.parse(json)) filas.set(k(d, r.tabla, r.id), { dispositivo: d, tabla: r.tabla, id: r.id, datos: r.datos, borrado: false, actualizado: reloj++ });
      return [];
    }
    if (t.includes('update registros set borrado')) {
      const [d, json] = p as [string, string];
      for (const r of JSON.parse(json)) {
        const f = filas.get(k(d, r.tabla, r.id));
        if (f) { f.borrado = true; f.actualizado = reloj++; }
      }
      return [];
    }
    if (t.includes('select tabla, id, datos from registros')) {
      const [d, tabla, id] = p as string[];
      return [...filas.values()]
        .filter((f) => f.dispositivo === d && !f.borrado && (f.tabla > tabla! || (f.tabla === tabla && f.id > id!)))
        .sort((a, b) => (a.tabla < b.tabla ? -1 : a.tabla > b.tabla ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, 1000)
        .map((f) => ({ tabla: f.tabla, id: f.id, datos: f.datos }));
    }
    throw new Error('consulta no entendida: ' + t.slice(0, 80));
  };
  const fetchFalso = async (url: string | URL | Request, init?: RequestInit) =>
    manejar(new Request(new URL(String(url), 'http://kiosco.test'), init), { consulta, clave: undefined });
  return { filas, v2, equipos, config, intentos, consulta, fetchFalso };
}
