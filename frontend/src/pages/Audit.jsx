import React from 'react';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';

const ACTION_META = {
  LOGIN: { label: 'Inicio de sesión', tone: 'success' },
  LOGOUT: { label: 'Cierre de sesión', tone: 'neutral' },
  CREATE_SITE: { label: 'Creación de estación', tone: 'success' },
  CREATE_VARIABLE: { label: 'Creación de variable', tone: 'success' },
  CREATE_MEASUREMENT: { label: 'Registro de medición', tone: 'success' },
  UPDATE_MEASUREMENT: { label: 'Edición de medición', tone: 'info' },
  DELETE_MEASUREMENT: { label: 'Eliminación de medición', tone: 'danger' },
  RUN_PREDICTION: { label: 'Ejecución de predicción IA', tone: 'info' },
  CREATE_USER: { label: 'Creación de usuario', tone: 'success' },
  UPDATE_USER: { label: 'Actualización de usuario', tone: 'warning' },
};

const ENTITY_LABELS = {
  users: 'Usuarios',
  monitoring_sites: 'Estaciones',
  environmental_variables: 'Variables ambientales',
  measurements: 'Mediciones',
  prediction_runs: 'Predicciones IA',
};

export default function Audit() {
  const { data, error } = useRequest('/audit');

  return (
    <>
      <Heading
        title="Bitácora de auditoría"
        description="Registro de acciones sobre usuarios, mediciones, predicciones y sesiones."
      />
      <Notice error={error} />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>Registro</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((x) => {
              const action = ACTION_META[x.action] || { label: x.action, tone: 'neutral' };
              const entity = x.entity_type ? ENTITY_LABELS[x.entity_type] || x.entity_type : '—';
              return (
                <tr key={x.id}>
                  <td>{new Date(x.occurred_at).toLocaleString('es-PE')}</td>
                  <td>
                    <div className="font-semibold text-ink">{x.user_name || 'Sistema'}</div>
                    {x.user_email && <div className="text-xs muted">{x.user_email}</div>}
                  </td>
                  <td>
                    <Badge tone={action.tone}>{action.label}</Badge>
                  </td>
                  <td>{entity}</td>
                  <td className="muted">{x.entity_id ? `#${x.entity_id}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data?.length && <p className="muted p-4">No hay entradas de auditoría.</p>}
      </section>
    </>
  );
}
