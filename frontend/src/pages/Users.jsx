import React, { useState } from 'react';
import { Pencil, Plus, Power } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  ConfirmDialog,
  Heading,
  Modal,
  Notice,
  useRequest,
} from '../components/Shared';

export default function UsersPage() {
  const { data: users, reload } = useRequest('/users');
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'user',
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [toggleUser, setToggleUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/users', { method: 'POST', body: form });
      setSuccess('Usuario creado correctamente.');
      setForm({ full_name: '', email: '', password: '', role: 'user' });
      setCreateOpen(false);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editUser) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/users/' + editUser.id, {
        method: 'PATCH',
        body: {
          full_name: editUser.full_name,
          role: editUser.role,
          status: editUser.status,
        },
      });
      setSuccess('Usuario actualizado correctamente.');
      setEditUser(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggle() {
    if (!toggleUser) return;
    setError('');
    setSuccess('');
    setSaving(true);
    const nextStatus = toggleUser.status === 'active' ? 'inactive' : 'active';
    try {
      await api('/users/' + toggleUser.id, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setSuccess(
        nextStatus === 'active' ? 'Cuenta activada correctamente.' : 'Cuenta desactivada correctamente.'
      );
      setToggleUser(null);
      reload();
    } catch (err) {
      setError(err.message);
      setToggleUser(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Usuarios y permisos"
        description="Gestión de cuentas con roles diferenciados y control de acceso."
        action={
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError('');
              setCreateOpen(true);
            }}
          >
            <Plus size={17} /> Nuevo usuario
          </button>
        }
      />
      <Notice error={error} success={success} />

      <section className="panel">
        <h2 className="h2">Cuentas existentes ({users?.length ?? 0})</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold text-ink">{u.full_name}</td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>
                      {u.role === 'admin' ? 'Administrador' : 'Usuario'}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={u.status === 'active' ? 'success' : 'danger'}>
                      {u.status === 'active' ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-leaf bg-emerald-50 hover:bg-emerald-100"
                        onClick={() =>
                          setEditUser({
                            id: u.id,
                            full_name: u.full_name,
                            email: u.email,
                            role: u.role,
                            status: u.status,
                          })
                        }
                      >
                        <Pencil size={13} /> Editar
                      </button>
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                          u.status === 'active'
                            ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                            : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                        onClick={() => setToggleUser(u)}
                      >
                        <Power size={13} />
                        {u.status === 'active' ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={createOpen}
        title="Crear nueva cuenta"
        subtitle="La contraseña debe tener al menos 10 caracteres."
        onClose={() => setCreateOpen(false)}
        maxWidth="max-w-md"
      >
        <form className="space-y-4" onSubmit={add}>
          <div>
            <label>Nombre completo</label>
            <input
              className="form-field"
              type="text"
              required
              minLength={3}
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <label>Correo electrónico</label>
            <input
              className="form-field"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label>Contraseña</label>
            <input
              className="form-field"
              type="password"
              required
              minLength={10}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <label>Rol</label>
            <select
              className="form-field"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="user">Usuario</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreateOpen(false)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? 'Creando...' : 'Crear cuenta'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editUser)}
        title="Editar usuario"
        subtitle={editUser ? editUser.email : ''}
        onClose={() => setEditUser(null)}
        maxWidth="max-w-md"
      >
        {editUser && (
          <form className="space-y-4" onSubmit={saveEdit}>
            <div>
              <label>Nombre completo</label>
              <input
                className="form-field"
                type="text"
                required
                minLength={3}
                value={editUser.full_name}
                onChange={(e) => setEditUser({ ...editUser, full_name: e.target.value })}
              />
            </div>
            <div>
              <label>Rol</label>
              <select
                className="form-field"
                value={editUser.role}
                onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
              >
                <option value="user">Usuario</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div>
              <label>Estado</label>
              <select
                className="form-field"
                value={editUser.status}
                onChange={(e) => setEditUser({ ...editUser, status: e.target.value })}
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditUser(null)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button className="btn" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleUser)}
        title={toggleUser?.status === 'active' ? 'Desactivar cuenta' : 'Activar cuenta'}
        message={
          toggleUser
            ? toggleUser.status === 'active'
              ? `¿Deseas desactivar el acceso para ${toggleUser.full_name} (${toggleUser.email})?`
              : `¿Deseas reactivar el acceso para ${toggleUser.full_name} (${toggleUser.email})?`
            : ''
        }
        confirmLabel={toggleUser?.status === 'active' ? 'Desactivar' : 'Activar'}
        danger={toggleUser?.status === 'active'}
        loading={saving}
        onConfirm={confirmToggle}
        onCancel={() => setToggleUser(null)}
      />
    </>
  );
}
