import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Btn from "../components/Btn";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("customers").select("*").order("name");
      setCustomers(data || []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Customers" action={<Btn sz="sm">+ Add Customer</Btn>} />
      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <DataTable
          cols={[
            { k: "name",    l: "Company",  r: v => <span style={{ fontWeight: 800, fontFamily: F.display, letterSpacing: "0.03em" }}>{v}</span> },
            { k: "address", l: "Address" },
            { k: "phone",   l: "Phone" },
            { k: "_a",      l: "",         r: () => <Btn sz="sm" v="ghost">View</Btn> },
          ]}
          rows={customers}
        />
      )}
    </div>
  );
}
