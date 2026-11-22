import React, { useState } from 'react';
import { FileDown, Image } from 'lucide-react';
import { downloadReport } from '../lib/api';
import { Filters, Heading, Notice, useRequest } from '../components/Shared';

export default function Reports() {
  const { data: sites } = useRequest('/catalogs/sites');
  const { data: variables } = useRequest('/catalogs/variables');
  const [site, setSite] = useState('');
  const [variable, setVariable] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [graph, setGraph] = useState(true);
  const [error, setError] = useState('');

  async function exportFile(format) {
    setError('');
    try {
      await downloadReport(format, {
        site_id: site,
        variable_id: variable,
        from: from ? new Date(from).toISOString() : '',
        to: to ? new Date(to).toISOString() : '',
        graph: graph && format !== 'xlsx' ? '1' : '0',
      });
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <Heading
        title="Reportes ambientales"
        description="Documentos listos para descargar con filtros, trazabilidad de origen y figura embebida."
      />
      <Notice error={error} />
      <section className="panel max-w-4xl">
        <h2 className="h2">Filtros del informe</h2>
        <Filters
          sites={sites || []}
          variables={variables || []}
          site={site}
          setSite={setSite}
          variable={variable}
          setVariable={setVariable}
        />
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div>
            <label>Desde</label>
            <input type="datetime-local" className="form-field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>Hasta</label>
            <input type="datetime-local" className="form-field" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center gap-2.5 mt-5 cursor-pointer select-none">
          <input type="checkbox" checked={graph} onChange={(e) => setGraph(e.target.checked)} />
          <Image size={15} className="text-leaf" />
          <span className="text-sm text-slate-700">
            Incluir gráfico de la serie embebido (aplica a PDF y Word; Excel conserva los datos tabulares)
          </span>
        </label>

        <div className="flex flex-wrap gap-3 mt-7">
          {['pdf', 'docx', 'xlsx'].map((format) => (
            <button key={format} className="btn" onClick={() => exportFile(format)}>
              <FileDown size={17} />
              Exportar {format.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="muted text-xs mt-5">
          Límite de consulta: 10 000 registros. Word: máximo 1 000 filas de detalle. El gráfico se genera a
          partir de los promedios diarios según la estación y variable seleccionadas. Los resultados no
          representan certificación oficial.
        </p>
      </section>
    </>
  );
}
