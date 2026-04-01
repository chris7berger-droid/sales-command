import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { inits } from "../lib/utils";
import { ROLE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

const ROLES = ["Admin", "Manager", "Sales Rep", "Office Staff", "Estimator", "Field"];

function MemberModal({ member, onClose, onSaved, senderEmail, senderName }) {
  const editing = !!member;
  const [form, setForm] = useState({
    name:   member?.name   || "",
    email:  member?.email  || "",
    phone:  member?.phone  || "",
    role:   member?.role   || "Sales Rep",
    active: member?.active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [error,  setError]  = useState("");
  const [success, setSuccess] = useState("");

  const set = k => v => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async (sendInvite = false) => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!form.email.trim()) { setError("Email is required."); return; }
    setSaving(true);
    setError("");
    setSuccess("");

    // Check for duplicates (exclude current member if editing)
    const { data: dupes } = await supabase
      .from("team_members")
      .select("id, name, email, phone")
      .or(`email.eq.${form.email.trim()},name.eq.${form.name.trim()}${form.phone.trim() ? `,phone.eq.${form.phone.trim()}` : ""}`);
    const conflicts = (dupes || []).filter(d => d.id !== member?.id);
    if (conflicts.length > 0) {
      const fields = [];
      if (conflicts.some(d => d.email === form.email.trim())) fields.push("email");
      if (conflicts.some(d => d.name === form.name.trim())) fields.push("name");
      if (form.phone.trim() && conflicts.some(d => d.phone === form.phone.trim())) fields.push("phone");
      setError(`This ${fields.join(", ")} is already in use by another team member.`);
      setSaving(false);
      return;
    }
    let memberId = member?.id;
    if (editing) {
      const { error: err } = await supabase
        .from("team_members")
        .update({ name: form.name, email: form.email, phone: form.phone, role: form.role, active: form.active })
        .eq("id", member.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { data: inserted, error: err } = await supabase
        .from("team_members")
        .insert({ name: form.name, email: form.email, phone: form.phone, role: form.role, active: true, onboarded: !sendInvite })
        .select("id")
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      memberId = inserted.id;
    }
    if (sendInvite) {
      await sendInviteEmail(form.email, form.name, memberId, !editing);
    } else {
      setSaving(false);
      onSaved();
    }
  };

  const sendInviteEmail = async (email, name, teamMemberId, isNew = false) => {
    setInviting(true);
    setError("");
    // Mark as not onboarded so they see the welcome screen on first login
    await supabase.from("team_members").update({ onboarded: false }).eq("id", teamMemberId);
    const { data, error: fnErr } = await supabase.functions.invoke("invite-user", {
      body: { email, name, teamMemberId, senderEmail, senderName },
    });
    setInviting(false);
    setSaving(false);
    if (fnErr || data?.error) {
      const msg = data?.error || fnErr?.message || "Failed to send invite";
      console.error("invite-user error:", { fnErr, data });
      // Roll back the inserted row if this was a new member
      if (isNew) await supabase.from("team_members").delete().eq("id", teamMemberId);
      setError(msg);
      return;
    }
    setSuccess("Invite sent!");
    setTimeout(() => onSaved(), 1200);
  };

  const inp = (label, key, type = "text") => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, marginBottom: 4 }}>{label}</div>
      <input
        type={type}
        value={form[key]}
        onChange={e => set(key)(e.target.value)}
        style={{ width: "100%", border: `1.5px solid ${C.borderStrong}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: F.ui, outline: "none", boxSizing: "border-box", background: C.linenLight, color: C.textHead }}
        onFocus={e => e.target.style.borderColor = C.teal}
        onBlur={e => e.target.style.borderColor = C.borderStrong}
      />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.linen, borderRadius: 14, width: "min(480px,94vw)", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: `1px solid ${C.borderStrong}`, background: C.linenCard }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em" }}>
            {editing ? "Edit Member" : "Add Team Member"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: C.textFaint, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "22px 22px 8px" }}>
          {inp("Full Name", "name")}
          {inp("Email", "email", "email")}
          {inp("Phone", "phone", "tel")}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, marginBottom: 4 }}>Role</div>
            <select value={form.role} onChange={e => set("role")(e.target.value)}
              style={{ width: "100%", border: `1.5px solid ${C.borderStrong}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, fontFamily: F.ui, outline: "none", background: C.linenLight, color: C.textHead }}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>

          {editing && !member.auth_id && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "12px 14px", background: "rgba(245,158,11,0.07)", borderRadius: 8, border: "1px solid rgba(245,158,11,0.2)" }}>
              <span style={{ fontSize: 13, color: C.amber, fontFamily: F.ui, fontWeight: 600 }}>This member has not been invited yet</span>
            </div>
          )}
          {editing && member.auth_id && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "12px 14px", background: form.active ? "rgba(76,175,80,0.07)" : "rgba(239,68,68,0.07)", borderRadius: 8, border: `1px solid ${form.active ? "rgba(76,175,80,0.2)" : "rgba(239,68,68,0.2)"}` }}>
              <input type="checkbox" id="active" checked={form.active}
                onChange={e => set("active")(e.target.checked)}
                style={{ accentColor: C.teal, width: 16, height: 16, cursor: "pointer" }} />
              <label htmlFor="active" style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui, cursor: "pointer", fontWeight: 600 }}>
                {form.active ? "Active — member can log in and use the app" : "Inactive — member is deactivated"}
              </label>
            </div>
          )}

          {error && <div style={{ fontSize: 12, color: C.red, fontFamily: F.ui, marginBottom: 12, padding: "8px 12px", background: "rgba(239,68,68,0.07)", borderRadius: 6 }}>{error}</div>}
          {success && <div style={{ fontSize: 12, color: C.green, fontFamily: F.ui, marginBottom: 12, padding: "8px 12px", background: "rgba(76,175,80,0.07)", borderRadius: 6 }}>{success}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 22px 20px" }}>
          {editing ? (
            <Btn sz="sm" v="ghost" onClick={async () => {
              if (!window.confirm(`Delete ${form.name}? This cannot be undone.`)) return;
              setSaving(true);
              const { data, error: fnErr } = await supabase.functions.invoke("delete-user", {
                body: { teamMemberId: member.id },
              });
              setSaving(false);
              if (fnErr || data?.error) { setError(data?.error || fnErr?.message || "Failed to delete"); return; }
              onSaved();
            }} disabled={saving}>
              <span style={{ color: C.red }}>Delete</span>
            </Btn>
          ) : <div />}
          <div style={{ display: "flex", gap: 8 }}>
          <Btn sz="sm" v="ghost" onClick={onClose}>Cancel</Btn>
          {editing && !member.auth_id && (
            <Btn sz="sm" onClick={() => sendInviteEmail(form.email, form.name, member.id)} disabled={inviting}>
              {inviting ? "Sending…" : "Send Invite"}
            </Btn>
          )}
          {editing ? (
            <Btn sz="sm" v={member.auth_id ? undefined : "ghost"} onClick={() => handleSave(false)} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Btn>
          ) : (
            <>
              <Btn sz="sm" v="ghost" onClick={() => handleSave(false)} disabled={saving}>{saving ? "Saving…" : "Add Without Invite"}</Btn>
              <Btn sz="sm" onClick={() => handleSave(true)} disabled={saving || inviting}>{saving || inviting ? "Sending…" : "Add & Send Invite"}</Btn>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Team({ teamMember }) {
  const [team,      setTeam]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null); // null | "add" | member object

  async function load() {
    const { data } = await supabase.from("team_members").select("*").order("name");
    setTeam(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const handleSaved = () => { setModal(null); load(); };

  const active   = team.filter(m => m.active !== false);
  const inactive = team.filter(m => m.active === false);

  const MemberCard = ({ m }) => (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20, boxShadow: "0 2px 8px rgba(28,24,20,0.07)", opacity: m.active === false ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.dark, border: `2px solid ${m.active === false ? C.textFaint : C.teal}`, color: m.active === false ? C.textFaint : C.teal, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 14, flexShrink: 0, fontFamily: F.display, letterSpacing: "0.05em" }}>
          {inits(m.name)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em" }}>{m.name}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Pill label={m.role} cm={ROLE_C} />
            {!m.auth_id && m.active !== false && (
              <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.dark, borderRadius: 4, padding: "2px 8px", fontFamily: F.ui, letterSpacing: "0.05em", textTransform: "uppercase" }}>Needs Invite</span>
            )}
          </div>
        </div>
        <button onClick={() => setModal(m)}
          style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.textFaint, cursor: "pointer", fontFamily: F.ui }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textFaint; }}>
          Edit
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui }}>✉ <a href={`mailto:${m.email}`} style={{ color: C.tealDark }}>{m.email}</a></div>
        <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui }}>📱 {m.phone}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Our Team" action={<Btn sz="sm" onClick={() => setModal("add")}>+ Add Member</Btn>} />

      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 14 }}>
            {active.map(m => <MemberCard key={m.id} m={m} />)}
          </div>

          {inactive.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, marginTop: 8 }}>Inactive Members</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 14 }}>
                {inactive.map(m => <MemberCard key={m.id} m={m} />)}
              </div>
            </>
          )}
        </>
      )}

      {modal && (
        <MemberModal
          member={modal === "add" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          senderEmail={teamMember?.email}
          senderName={teamMember?.name}
        />
      )}
    </div>
  );
}