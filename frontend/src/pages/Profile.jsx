import React, { useState } from 'react';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Heading, Notice, useRequest } from '../components/Shared';

export default function Profile({ onLogout }) {
  const { data, error } = useRequest('/profile');
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    setNotice('');
    if (form.new_password.length < 10) {
      setFormError('La nueva contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (form.new_password !== form.confirm) {
      setFormError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setSaving(true);
    try {
      await api('/profile/password', {
        method: 'PUT',
        body: { current_password: form.current_password, new_password: form.new_password },
      });
      setNotice('Contraseña actualizada. Por seguridad se cerrará la sesión para volver a ingresar.');
      setForm({ current_password: '', new_password: '', confirm: '' });
      // El backend revoca todos los refresh tokens: se fuerza reautenticación.
      setTimeout(() => onLogout && onLogout(), 1800);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Mi perfil"
        description="Consulta los datos de tu cuenta y actualiza tu contraseña de acceso."
      />
      <Notice error={error} success={notice} />

      <div className="grid xl:grid-cols-2 gap-5">
        <section className="panel">
          <div className="flex items-center gap-2 mb-4">
            <UserRound size={18} className="text-leaf" />
            <h2 className="h2 mb-0">Datos de la cuenta</h2>
          </div>
          {data ? (
            <dl className="space-y-3 text-sm">
              {[
                ['Nombre completo', data.full_name],
                ['Correo electrónico', data.email],
                ['Rol', data.role === 'admin' ? 'Administrador' : 'Usuario'],
                ['Estado', data.status === 'active' ? 'Activo' : 'Inactivo'],
                ['Registrado', data.created_at ? new Date(data.created_at).toLocaleString('es-PE') : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2.5">
                  <dt className="muted">{k}</dt>
                  <dd className="font-semibold text-ink text-right">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Cargando datos de la cuenta…</p>
          )}
        </section>

        <section className="panel">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound size={18} className="text-leaf" />
            <h2 className="h2 mb-0">Cambio de contraseña</h2>
          </div>
          <Notice error={formError} />
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label>Contraseña actual</label>
              <input
                type="password"
                required
                autoComplete="current-password"
                className="form-field"
                value={form.current_password}
                onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              />
            </div>
            <div>
              <label>Nueva contraseña (mínimo 10 caracteres)</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                className="form-field"
                value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              />
            </div>
            <div>
              <label>Confirmar nueva contraseña</label>
              <input
                type="password"
                required
                autoComplete="new-password"
                className="form-field"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              />
            </div>
            <button className="btn w-full" disabled={saving}>
              {saving ? 'Actualizando…' : 'Actualizar contraseña'}
            </button>
          </form>
          <div className="mt-4 flex gap-2.5 rounded-xl border border-sky-100 bg-sky-50/60 p-3.5">
            <ShieldCheck size={16} className="text-sky-600 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-700 leading-relaxed">
              Al cambiar la contraseña se revocan todas las sesiones activas. Deberás iniciar sesión de
              nuevo con la nueva contraseña. La acción queda registrada en la bitácora de auditoría.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
