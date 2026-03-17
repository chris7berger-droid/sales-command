// SC-20 — Call Log Row Detail View
import { useState } from 'react';
import { supabase } from './supabaseClient';

const STAGES = ['New Inquiry', 'Wants Bid', 'Has Bid', 'Sold', 'Lost'];

export default function CallLogDetail({ job, teamMembers, workTypes, onBack, onSaved }) {
  const [form, setForm] = useState({
    stage: job.stage || '',
    bid_due: job.bid_due || '',
    follow_up_date: job.follow_up_date || '',
    notes: job.notes || '',
    assigned_to: job.assigned_to || '',
    jobsite_address: job.jobsite_address || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from('call_log')
      .update({
        stage: form.stage,
        bid_due: form.bid_due || null,
        follow_up_date: form.follow_up_date || null,
        notes: form.notes,
        assigned_to: form.assigned_to || null,
        jobsite_address: form.jobsite_address || null,
      })
      .eq('id', job.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved && onSaved();
  }

  const customer = job.customers;
  const rep = teamMembers.find(m => m.id === form.assigned_to);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 820 }}>

      {/* Back */}
      <button onClick={onBack} style={styles.backBtn}>← Call Log</button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f0ff' }}>
          {job.display_job_number}
        </h2>
        <span style={{ ...styles.stagePill, background: stageColor(form.stage) }}>
          {form.stage || 'No Stage'}
        </span>
      </div>
      <div style={{ color: '#888', fontSize: 13, marginBottom: 28 }}>
        {customer?.company_name || customer?.name || '—'} · {customer?.city || ''}
      </div>

      {/* Sections */}
      <div style={styles.grid}>

        {/* Stage */}
        <Field label="Stage">
          <select value={form.stage} onChange={e => set('stage', e.target.value)} style={styles.input}>
            <option value="">— Select —</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        {/* Assigned Rep */}
        <Field label="Assigned Rep">
          <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={styles.input}>
            <option value="">— Unassigned —</option>
            {teamMembers.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </Field>

        {/* Bid Due */}
        <Field label="Bid Due">
          <input type="date" value={form.bid_due} onChange={e => set('bid_due', e.target.value)} style={styles.input} />
        </Field>

        {/* Follow-Up */}
        <Field label="Follow-Up Date">
          <input type="date" value={form.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} style={styles.input} />
        </Field>

        {/* Jobsite Address — full width */}
        <Field label="Jobsite Address" wide>
          <input
            type="text"
            value={form.jobsite_address}
            onChange={e => set('jobsite_address', e.target.value)}
            placeholder="Street, City, State ZIP"
            style={styles.input}
          />
        </Field>

        {/* Notes — full width */}
        <Field label="Notes" wide>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={4}
            style={{ ...styles.input, resize: 'vertical' }}
          />
        </Field>
      </div>

      {/* Work Types (read-only) */}
      {job.job_work_types?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={styles.sectionLabel}>Work Types</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {job.job_work_types.map(jw => (
              <span key={jw.id} style={styles.wtPill}>
                {workTypes.find(w => w.id === jw.work_type_id)?.name || jw.work_type_id}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Read-only info */}
      <div style={{ display: 'flex', gap: 32, marginBottom: 28, color: '#888', fontSize: 13 }}>
        <span>Created: {job.created_at ? new Date(job.created_at).toLocaleDateString() : '—'}</span>
        <span>Job Type: {job.job_type || '—'}</span>
        {job.parent_job_id && <span>Parent Job: {job.parent_job_id}</span>}
      </div>

      {/* Save */}
      {error && <div style={styles.error}>{error}</div>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saved && <span style={{ color: '#4ade80', fontSize: 13 }}>✓ Saved</span>}
      </div>
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : 'span 1' }}>
      <div style={styles.sectionLabel}>{label}</div>
      {children}
    </div>
  );
}

function stageColor(stage) {
  const map = {
    'New Inquiry': '#1e3a5f',
    'Wants Bid': '#3b2f00',
    'Has Bid': '#1a3a2a',
    'Sold': '#1a2e1a',
    'Lost': '#3a1a1a',
  };
  return map[stage] || '#2a2a3a';
}

const styles = {
  backBtn: {
    background: 'none', border: 'none', color: '#7b7bff',
    fontSize: 13, cursor: 'pointer', padding: '0 0 20px 0',
    fontFamily: 'inherit', letterSpacing: '0.02em',
  },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: '16px 24px', marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#666', marginBottom: 6,
  },
  input: {
    width: '100%', background: '#1a1a2e', border: '1px solid #2e2e50',
    borderRadius: 6, padding: '8px 10px', color: '#e0e0ff',
    fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
  },
  stagePill: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
    textTransform: 'uppercase', padding: '3px 10px',
    borderRadius: 20, color: '#bbb',
  },
  wtPill: {
    background: '#1e1e3a', border: '1px solid #2e2e50',
    borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#aaa',
  },
  saveBtn: {
    background: '#4f46e5', border: 'none', borderRadius: 8,
    padding: '10px 24px', color: '#fff', fontWeight: 700,
    fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  },
  error: {
    color: '#f87171', fontSize: 13, marginBottom: 12,
  },
};