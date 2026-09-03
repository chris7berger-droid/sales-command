import { createContext, useContext, useState, useCallback } from "react";
import { invKey } from "./utils";
import * as store from "./arStore";

const ARContext = createContext(null);

export function ARProvider({ children }) {
  const [customers, setCustomers] = useState([]);
  const [allInvoices, setAllInvoices] = useState([]);
  const [reportDate, setReportDate] = useState("");
  const [notes, setNotes] = useState({});
  const [retFlags, setRetFlags] = useState({});
  const [collFlags, setCollFlags] = useState({});
  const [gobackFlags, setGobackFlags] = useState({});
  const [acctFlags, setAcctFlags] = useState({});
  const [custEmails, setCustEmails] = useState({});
  const [expectedDates, setExpectedDates] = useState({});
  const [triageFlags, setTriageFlags] = useState({});
  const [decisions, setDecisions] = useState({});
  const [loaded, setLoaded] = useState(false);

  const loadAll = useCallback(() => {
    const d = store.loadReportData();
    if (d) {
      setCustomers(d.customers);
      setAllInvoices(d.invoices);
      setReportDate(d.reportDate);
    }
    setNotes(store.loadNotes());
    setRetFlags(store.loadRetFlags());
    setCollFlags(store.loadCollFlags());
    setGobackFlags(store.loadGobackFlags());
    setAcctFlags(store.loadAcctFlags());
    setCustEmails(store.loadEmails());
    setExpectedDates(store.loadExpDates());
    setTriageFlags(store.loadTriage());
    setDecisions(store.loadDecisions());
    setLoaded(true);
    return !!d;
  }, []);

  const importReport = useCallback((custs, invs, date) => {
    setCustomers(custs);
    setAllInvoices(invs);
    setReportDate(date);
    store.saveReportData(custs, invs, date);
    setLoaded(true);
  }, []);

  const updateNotes = useCallback((next) => { setNotes(next); store.saveNotes(next); }, []);
  const updateRetFlags = useCallback((next) => { setRetFlags(next); store.saveRetFlags(next); }, []);
  const updateCollFlags = useCallback((next) => { setCollFlags(next); store.saveCollFlags(next); }, []);
  const updateGobackFlags = useCallback((next) => { setGobackFlags(next); store.saveGobackFlags(next); }, []);
  const updateAcctFlags = useCallback((next) => { setAcctFlags(next); store.saveAcctFlags(next); }, []);
  const updateEmails = useCallback((next) => { setCustEmails(next); store.saveEmails(next); }, []);
  const updateExpDates = useCallback((next) => { setExpectedDates(next); store.saveExpDates(next); }, []);
  const updateTriage = useCallback((next) => { setTriageFlags(next); store.saveTriage(next); }, []);
  const updateDecisions = useCallback((next) => { setDecisions(next); store.saveDecisions(next); }, []);

  // Flag check helpers
  const autoDetectRetention = (inv) => {
    const num = (inv.num || "").toUpperCase();
    const job = (inv.job || "").toUpperCase();
    const full = (inv.fullName || "").toUpperCase();
    return num.includes("RET") || job.includes("RETENTION") || job.includes("RENTENTION") || full.includes("RETENTION") || full.includes("RENTENTION");
  };
  const isRetention = (inv, cn) => { const k = invKey(cn, inv.num, inv.date); return retFlags[k] !== undefined ? retFlags[k] : autoDetectRetention(inv); };
  const isCollections = (inv, cn) => { const k = invKey(cn, inv.num, inv.date); return !!collFlags[k]; };
  const isGoback = (inv, cn) => { const k = invKey(cn, inv.num, inv.date); return !!gobackFlags[k]; };
  const isAccountantReview = (inv, cn) => { const k = invKey(cn, inv.num, inv.date); return !!acctFlags[k]; };

  const getCustBuckets = (c, exRet) => {
    if (!exRet) return { current: c.current, days30: c.days30, days60: c.days60, days90: c.days90, over90: c.over90, total: c.total };
    const r = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
    c.invoices.forEach((inv) => {
      if (!isRetention(inv, c.name) && !isCollections(inv, c.name) && !isGoback(inv, c.name)) {
        r[inv.bucket] += inv.openBalance; r.total += inv.openBalance;
      }
    });
    return r;
  };
  const getCustRetTotal = (c) => { let t = 0; c.invoices.forEach((inv) => { if (isRetention(inv, c.name) && !isCollections(inv, c.name) && !isGoback(inv, c.name)) t += inv.openBalance; }); return t; };
  const getCustCollTotal = (c) => { let t = 0; c.invoices.forEach((inv) => { if (isCollections(inv, c.name)) t += inv.openBalance; }); return t; };
  const getCustGobackTotal = (c) => { let t = 0; c.invoices.forEach((inv) => { if (isGoback(inv, c.name)) t += inv.openBalance; }); return t; };
  const getCustAcctTotal = (c) => { let t = 0; c.invoices.forEach((inv) => { if (isAccountantReview(inv, c.name)) t += inv.openBalance; }); return t; };

  const getNotes = (k) => (notes[k] || []).slice().sort((a, b) => b.ts - a.ts);
  const getLastOutreach = (cn, inv) => {
    const k = invKey(cn, inv.num, inv.date);
    const n = notes[k] || [];
    for (let i = n.length - 1; i >= 0; i--) { if (n[i].outreach !== undefined) return n[i]; }
    return null;
  };

  const getTotals = () => {
    const t = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0, retention: 0, collections: 0, goback: 0, acct: 0, cCur: 0, c30: 0, c60: 0, c90: 0, cO90: 0, cRet: 0, cColl: 0, cGo: 0, cAcct: 0 };
    customers.forEach((c) => {
      const ret = getCustRetTotal(c); t.retention += ret; if (ret) t.cRet++;
      const coll = getCustCollTotal(c); t.collections += coll; if (coll) t.cColl++;
      const go = getCustGobackTotal(c); t.goback += go; if (go) t.cGo++;
      const acct = getCustAcctTotal(c); t.acct += acct; if (acct) t.cAcct++;
      const nr = getCustBuckets(c, true);
      if (nr.current > 0) t.cCur++; if (nr.days30) t.c30++; if (nr.days60) t.c60++; if (nr.days90) t.c90++; if (nr.over90) t.cO90++;
      t.current += nr.current; t.days30 += nr.days30; t.days60 += nr.days60; t.days90 += nr.days90; t.over90 += nr.over90; t.total += c.total;
    });
    return t;
  };

  const getFiltered = (filter, search, sortByCol, sortDirection) => {
    let list = customers.slice();
    if (filter === "retention") list = list.filter((c) => getCustRetTotal(c) > 0);
    else if (filter === "collections") list = list.filter((c) => getCustCollTotal(c) > 0);
    else if (filter === "goback") list = list.filter((c) => getCustGobackTotal(c) > 0);
    else if (filter === "acctreview") list = list.filter((c) => getCustAcctTotal(c) > 0);
    else if (filter === "current") list = list.filter((c) => getCustBuckets(c, true).current > 0);
    else if (filter === "days30") list = list.filter((c) => getCustBuckets(c, true).days30 !== 0);
    else if (filter === "days60") list = list.filter((c) => getCustBuckets(c, true).days60 !== 0);
    else if (filter === "days90") list = list.filter((c) => getCustBuckets(c, true).days90 !== 0);
    else if (filter === "over90") list = list.filter((c) => getCustBuckets(c, true).over90 !== 0);
    if (search) { const t = search.toLowerCase(); list = list.filter((c) => c.name.toLowerCase().includes(t)); }
    const exRet = filter !== "all" && filter !== "retention";
    list.sort((a, b) => {
      if (sortByCol === "name") return sortDirection === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const va = getCustBuckets(a, exRet)[sortByCol] || 0, vb = getCustBuckets(b, exRet)[sortByCol] || 0;
      return sortDirection === "asc" ? va - vb : vb - va;
    });
    return list;
  };

  return (
    <ARContext.Provider value={{
      customers, allInvoices, reportDate, loaded,
      notes, retFlags, collFlags, gobackFlags, acctFlags, custEmails, expectedDates, triageFlags, decisions,
      loadAll, importReport,
      updateNotes, updateRetFlags, updateCollFlags, updateGobackFlags, updateAcctFlags, updateEmails, updateExpDates, updateTriage, updateDecisions,
      isRetention, isCollections, isGoback, isAccountantReview,
      getCustBuckets, getCustRetTotal, getCustCollTotal, getCustGobackTotal, getCustAcctTotal,
      getNotes, getLastOutreach, getTotals, getFiltered,
    }}>
      {children}
    </ARContext.Provider>
  );
}

export function useAR() {
  const ctx = useContext(ARContext);
  if (!ctx) throw new Error("useAR must be inside ARProvider");
  return ctx;
}
