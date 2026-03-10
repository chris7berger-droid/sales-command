import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { inits } from "../lib/utils";
import { ROLE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

export default function Team() {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("team_members").select("*").order("name");
      setTeam(data || []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Our Team" action={<Btn sz="sm">+ Add Member</Btn>} />
      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 14 }}>
          {team.map(m => (
            <div key={m.id} style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20, boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.dark, border: `2px solid ${C.teal}`, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 14, flexShrink: 0, fontFamily: F.display, letterSpacing: "0.05em" }}>
                  {inits(m.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em" }}>{m.name}</div>
                  <Pill label={m.role} cm={ROLE_C} />
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui }}>✉ <a href={`mailto:${m.email}`} style={{ color: C.tealDark }}>{m.email}</a></div>
                <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui }}>📱 {m.phone}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}