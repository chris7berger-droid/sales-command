import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { calcLabor, calcMaterialRow, calcTravel, calcWtcPrice as calcWtcTotal } from "../lib/calc";
import { getTenantConfig, DEFAULTS } from "../lib/config";

// ── Design tokens ──────────────────────────────────────────────────────────
const T = {
  green: "#30cfac", greenDark: "#1a8a72", greenLight: "rgba(48,207,172,0.12)",
  blue: "#1976D2", blueLight: "#E3F2FD",
  gray50: "#b5a896", gray100: "#bfb3a1", gray200: "rgba(28,24,20,0.12)",
  gray300: "rgba(28,24,20,0.2)", gray400: "#887c6e", gray500: "#6b6358",
  gray600: "#4a4238", gray700: "#2d2720", gray800: "#1c1814", gray900: "#1c1814",
  white: "#c8bcaa", red: "#e53935", amber: "#F59E0B",
  dark: "#1c1814", darkRaised: "#28231d", darkCard: "#322c25",
};

// ── 159 Materials ──────────────────────────────────────────────────────────
const MATERIALS_DB = [
  { name:"Aerosil (cabosil)", kit:"22lbs", price:448.90, supplier:"CSS", coverage:"" },
  { name:"Aerosil (cabosil) Key resins", kit:"20lbs", price:221.18, supplier:"Key Resins", coverage:"" },
  { name:"Ameripolish dye", kit:"1 gallon", price:69.00, supplier:"Runyon", coverage:"" },
  { name:"Ardex Ardifix", kit:"Cartridge", price:51.68, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex CD Fine", kit:"20lbs", price:46.93, supplier:"Tom Duffy", coverage:"50 Sqft/bag" },
  { name:"Ardex Concrete Guard", kit:"1 gallon", price:94.65, supplier:"Tom Duffy", coverage:"200 Sqft/gal" },
  { name:"Ardex CP", kit:"40lbs", price:48.43, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex EP2000", kit:"10 lbs", price:178.27, supplier:"Tom Duffy", coverage:"150-200 Sqft/unit" },
  { name:"Ardex feather finish", kit:"25lbs", price:21.00, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex K525", kit:"50lbs", price:44.75, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex MRF", kit:"10 lbs", price:17.06, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex PCT", kit:"50 Lbs", price:52.31, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex SDM Gray", kit:"10lbs", price:35.65, supplier:"Tom Duffy", coverage:"" },
  { name:"Ardex SDM White", kit:"10lbs", price:37.90, supplier:"Tom Duffy", coverage:"" },
  { name:"Armorhard (epoxy sand patch)", kit:"5 gallon", price:150.00, supplier:"CSS", coverage:"" },
  { name:"Armorseal 8100", kit:"1 gallon", price:125.82, supplier:"Sherwin Williams", coverage:"" },
  { name:"Armorseal 8100", kit:"5 gallon", price:486.00, supplier:"Sherwin Williams", coverage:"" },
  { name:"Ashford (densifier/sealer)", kit:"55 gallons", price:563.75, supplier:"CureCrete", coverage:"" },
  { name:"Backer Rod 1/4\"", kit:"6400 LF", price:137.25, supplier:"CSS", coverage:"" },
  { name:"Backer Rod 3/8\"", kit:"3600 LF", price:156.55, supplier:"CSS", coverage:"" },
  { name:"Backer Rod 7/8", kit:"850 LF", price:45.00, supplier:"CSS", coverage:"" },
  { name:"Ballistix", kit:"1 gallon", price:329.00, supplier:"", coverage:"800-1100 Sqft/gal" },
  { name:"Basf 400", kit:"5 gallon", price:185.00, supplier:"CSS", coverage:"" },
  { name:"Cohill Metallics", kit:"1.5 gallon", price:40.00, supplier:"CSS", coverage:"" },
  { name:"Colored chips (flake)", kit:"55lbs", price:125.00, supplier:"CSS/Westcoat/RPM", coverage:".15 lbs/Sqft" },
  { name:"Colored Quartz", kit:"55lbs", price:42.00, supplier:"CSS/Sika/Key Resins", coverage:"500 lbs/1000 Sqft" },
  { name:"Crown 320 (100 solids)", kit:"3 gallon", price:172.50, supplier:"", coverage:"" },
  { name:"Crown 7072sc (polyaspartic)", kit:"2 gallon", price:228.50, supplier:"CSS", coverage:"" },
  { name:"Crown 7072sc (polyaspartic)", kit:"10 gallon", price:1135.00, supplier:"CSS", coverage:"" },
  { name:"Crown 8175 (Polyaspartic) One day garage", kit:"2 gallon", price:195.00, supplier:"CSS", coverage:"" },
  { name:"Crown 8202 Water Base Epoxy", kit:"1.25 gallon", price:71.55, supplier:"CSS", coverage:"" },
  { name:"Crown 8202 Water Base Epoxy", kit:"5 gallon", price:275.35, supplier:"CSS", coverage:"" },
  { name:"Crown 8240 (Polyurea Coating)", kit:"3 gallon", price:162.00, supplier:"CSS", coverage:"" },
  { name:"Crown 8303 MVB", kit:"3 gallon", price:314.35, supplier:"CSS", coverage:"100 Sqft/gal" },
  { name:"Crown 8312 (cove gel)", kit:"3 gallon", price:276.10, supplier:"CSS", coverage:"" },
  { name:"Crown 8340 (Polyaspartic long working)", kit:"3 gallon", price:315.00, supplier:"", coverage:"" },
  { name:"Crown color pack", kit:"1 quart", price:48.00, supplier:"CSS", coverage:"" },
  { name:"Dal Coating (Line Striping Paint)", kit:"5 gallon", price:245.00, supplier:"Home Depot", coverage:"320LF/gal" },
  { name:"Dex-o-tex 1p primer", kit:"2.9 gallon", price:330.60, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-o-tex AeroFlor", kit:"2 gallon", price:260.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-O-Tex AJ44", kit:"5 gallon", price:300.00, supplier:"Dex-o-Tex", coverage:"" },
  { name:"Dex-o-tex Decoflor (100 solids epoxy)", kit:"3 gallon", price:183.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-o-tex Dexothane CRU (MATTE)", kit:"2.5 gallon", price:508.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-o-tex Positred (100 solids Epoxy)", kit:"3 gallon", price:225.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-o-tex Quikglaze (Polyaspartic)", kit:"3 gallon", price:435.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-o-tex W/B dex o cote (Water base)", kit:"2 gallon", price:143.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"Dex-o-tex weather seal xl (Acrylic)", kit:"5 gallon", price:220.00, supplier:"Dex-o-tex", coverage:"" },
  { name:"EP-90", kit:"10 gallon", price:500.00, supplier:"High Tec", coverage:"45 LF/unit" },
  { name:"Euclid Diamond Hard", kit:"5 gallon", price:110.00, supplier:"CSS", coverage:"" },
  { name:"Euclid Eucosil", kit:"5 gallon", price:50.00, supplier:"CSS", coverage:"" },
  { name:"Euclid stain (UV stable)", kit:"1 gallon", price:44.10, supplier:"CSS", coverage:"" },
  { name:"Fine Mesh Fabric", kit:"300 LF", price:18.00, supplier:"", coverage:"" },
  { name:"Flex set (warehouse patch)", kit:"5 gallon", price:117.00, supplier:"CSS", coverage:"" },
  { name:"Flowfresh SL", kit:"double pack", price:126.40, supplier:"Key Resins Direct", coverage:"63 Sqft/kit" },
  { name:"Flowfresh SR sealer", kit:"1.5 gallon", price:80.51, supplier:"Key Resins Direct", coverage:"120 Sqft/kit" },
  { name:"Galaxy foam (panel joint backer rod)", kit:"600 LF", price:225.00, supplier:"CSS", coverage:"" },
  { name:"GE Elemax 2600 (Weather proofing)", kit:"5 gallon", price:490.00, supplier:"CSS", coverage:"" },
  { name:"GE Elemax 5000 (Liquid Flashing)", kit:"20oz Sausage", price:12.53, supplier:"CSS", coverage:"" },
  { name:"GE Silpruf SCS2000 (Caulking)", kit:"20oz Sausage", price:14.50, supplier:"CSS", coverage:"" },
  { name:"H&C Infusion dye", kit:"1 gallon", price:70.00, supplier:"", coverage:"" },
  { name:"Hi-Tech PE85 (polyurea joint filler)", kit:"10 gallon", price:500.00, supplier:"Hi-Tec", coverage:"" },
  { name:"Hi-Tech PE90 (polyurea joint filler)", kit:"10 gallon", price:500.00, supplier:"High Tec", coverage:"" },
  { name:"High tech TX3", kit:"2 gallon", price:150.00, supplier:"Hi-Tec", coverage:"" },
  { name:"Key 520 Pigmented", kit:"3 Gallon", price:194.70, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resin Flowfresh PA", kit:"15 gallon", price:1516.67, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 445 W/B Matte urethane", kit:"1.25 gallon", price:122.63, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 450 (Aliphatic Urethane)", kit:"3 gallon", price:298.00, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 467 (HS Urethane Low Odor)", kit:"1.25 gallon", price:216.14, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 467 (HS Urethane Low Odor)", kit:"5 gallon", price:778.74, supplier:"Key Resins Direct", coverage:"500 Sqft/gal" },
  { name:"Key Resins 471 (polyaspartic)", kit:"3 gallon", price:329.94, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 471 (polyaspartic)", kit:"15 gallon", price:1748.55, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 502 (100 solids epoxy)", kit:"3 gallon", price:190.38, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 502 (100 solids epoxy)", kit:"15 gallon", price:906.15, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 510 CV (cove material)", kit:"5 gallon", price:312.75, supplier:"Key Resins Direct", coverage:"1.7 lbs/LF 6\" cove" },
  { name:"Key Resins 511 (100 solids epoxy)", kit:"3 gallon", price:178.99, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 511 (100 solids epoxy)", kit:"15 gallon", price:823.44, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 515", kit:"5 gallon", price:290.66, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 520 (100 solids epoxy) Pigmented", kit:"3 gallon", price:194.69, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 520 (100 solids epoxy) Pigmented", kit:"15 gallon", price:922.71, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 532 W/B epoxy", kit:"3 gallon", price:212.01, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 60/100 NSA (aluminum oxide)", kit:"1 gallon", price:60.06, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 615 (Chemical resistant epoxy)", kit:"15 gallon", price:965.40, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 615 Chemical resistant Epoxy", kit:"3 gallon", price:210.02, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 630 (pigmented novolac)", kit:"3 gallon", price:353.70, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 630 (pigmented novolac)", kit:"15 gallon", price:1701.60, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 633 (Novolac) Pigmented", kit:"3 Gallon", price:378.14, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 633 (Novolac) Pigmented", kit:"15 gallon", price:1836.80, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 635 (MVB Moisture block)", kit:"3.4 gallon", price:416.50, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins 803 W/B Acrylic sealer", kit:"5 Gallon", price:110.98, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins BMA-50 (trowel cove sand)", kit:"50 lbs", price:19.99, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins Cove Powder", kit:"50lbs", price:77.67, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins Epocoat", kit:"1.25 gallons", price:68.75, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins Epoglaze", kit:"1.5 gallon", price:135.00, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Resins Pigment pack", kit:"1qt", price:33.18, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key TS100 (Matting Agent)", kit:"1 gallon", price:13.00, supplier:"Key Resins Direct", coverage:"" },
  { name:"Key Urecon SLT (3/16 urethane)", kit:"1 kit", price:92.20, supplier:"Key Resins Direct", coverage:"" },
  { name:"Masterkure 300WB (Lapidolith)", kit:"55 gallons", price:945.00, supplier:"CSS", coverage:"35 gal/16000 Sqft" },
  { name:"MasterKure CC1315WB", kit:"5 gallon", price:205.00, supplier:"CSS +Freight", coverage:"200 Sqft/gal" },
  { name:"MasterSeal 658 (Tennis court)", kit:"5 gallon", price:210.00, supplier:"CSS +Freight", coverage:"90-125 Sqft/gal" },
  { name:"MasterSeal 658 Primer (Tennis court)", kit:"5 gallon", price:355.00, supplier:"CSS +Freight", coverage:"200-300 Sqft/gal" },
  { name:"MM80 Epoxy joint filler", kit:"10 gallon", price:506.00, supplier:"Runyon", coverage:"" },
  { name:"Neogard 70410", kit:"5 gallon", price:220.00, supplier:"CSS", coverage:"" },
  { name:"Neogard 70700/01", kit:"3 gallon", price:227.00, supplier:"CSS", coverage:"" },
  { name:"Neogard 70700/01", kit:"15 gallon", price:1005.00, supplier:"CSS", coverage:"" },
  { name:"Neogard 70704/05 Novolac Gray", kit:"5 gallon", price:641.25, supplier:"CSS", coverage:"" },
  { name:"Neogard 70714/15 (100 solids epoxy)", kit:"3 gallon", price:207.50, supplier:"CSS", coverage:"" },
  { name:"Neogard 70714/15 (100 solids epoxy)", kit:"15 gallon", price:963.50, supplier:"CSS", coverage:"" },
  { name:"Neogard 70734/35", kit:"3 gallon", price:232.80, supplier:"CSS", coverage:"" },
  { name:"Neogard 70817/70818 CRU", kit:"2 gallon", price:241.00, supplier:"CSS", coverage:"" },
  { name:"Neogard 7430", kit:"5 gallon", price:295.00, supplier:"CSS", coverage:"" },
  { name:"Neogard 7797/98", kit:"3 gallon", price:148.50, supplier:"CSS", coverage:"" },
  { name:"Neogard 7992 (16/30 sand)", kit:"100lbs", price:20.00, supplier:"CSS", coverage:"" },
  { name:"Neogard FC 7500/FC7960", kit:"5 gallon", price:260.00, supplier:"CSS", coverage:"" },
  { name:"Neogard FC 7540/FC7964", kit:"3 gallon", price:189.00, supplier:"CSS", coverage:"" },
  { name:"Neogard FC 7540/FC7964", kit:"6 gallon", price:359.00, supplier:"CSS", coverage:"" },
  { name:"Neogard FC 7545/FC7964", kit:"6 gallon", price:405.00, supplier:"CSS", coverage:"" },
  { name:"Neogard FC7548", kit:"3 gallon", price:215.00, supplier:"CSS", coverage:"" },
  { name:"New Look Quicketch", kit:"1 gallon", price:86.66, supplier:"CSS", coverage:"100 Sqft/gal" },
  { name:"New Look Quicketch", kit:"5 gallon", price:289.00, supplier:"CSS", coverage:"" },
  { name:"New Look Smart seal AU25", kit:"1 gallon", price:76.00, supplier:"CSS", coverage:"200 Sqft/gal" },
  { name:"New Look Smart seal AU25", kit:"5 gallon", price:252.00, supplier:"CSS", coverage:"" },
  { name:"Newlook Original Solid Stain", kit:"4 oz", price:48.00, supplier:"CSS", coverage:"35-45 Sqft/kit" },
  { name:"Newlook Original Solid Stain", kit:"32 oz", price:169.00, supplier:"CSS", coverage:"350-400 Sqft/kit" },
  { name:"Prosoco Siloxane PD", kit:"5 gallon", price:179.00, supplier:"CSS", coverage:"" },
  { name:"Prosoco LS guard", kit:"5 gallon", price:351.33, supplier:"Runyon", coverage:"" },
  { name:"Rapid Refloor", kit:"Cartridge", price:51.81, supplier:"CSS", coverage:"" },
  { name:"Retro Guard", kit:"5 gallon", price:325.00, supplier:"RetroPlate Direct", coverage:"" },
  { name:"Retro Plate 99", kit:"5 gallon", price:125.00, supplier:"RetroPlate Direct", coverage:"" },
  { name:"Retro Plate Retro Pel", kit:"5 gallons", price:345.00, supplier:"Retro plate", coverage:"600-1200 Sqft/gal" },
  { name:"RetroPlate", kit:"55 gallon", price:1375.00, supplier:"RetroPlate Direct", coverage:"200 Sqft/gal" },
  { name:"Rubber Crumb", kit:"50 lbs", price:105.00, supplier:"CSS", coverage:"300 Sqft/bag" },
  { name:"Scofield Formula One Guard", kit:"5 gallon", price:457.62, supplier:"Runyon", coverage:"" },
  { name:"Scofield Formula One Finish coat", kit:"1 gallon", price:121.00, supplier:"Runyon", coverage:"" },
  { name:"Scofield Formula One Lithium Densifier", kit:"5 gallon", price:441.48, supplier:"Runyon", coverage:"" },
  { name:"Seam tape (plywood deck joint tape)", kit:"100'", price:19.75, supplier:"CSS", coverage:"" },
  { name:"Sherwin Williams Armorseal 8100", kit:"1.25 gallon", price:122.50, supplier:"Sherwin Williams", coverage:"" },
  { name:"Sherwin Williams Armorseal 8100", kit:"5 gallon", price:475.00, supplier:"Sherwin Williams", coverage:"" },
  { name:"Sika 1000", kit:"50 lbs", price:29.25, supplier:"CSS", coverage:"" },
  { name:"Sika 1A", kit:"20 oz", price:7.95, supplier:"CSS", coverage:"" },
  { name:"Sika 2500", kit:"50 lbs", price:30.95, supplier:"CSS", coverage:"" },
  { name:"Sika 2c ns", kit:"1.5 gallon", price:65.00, supplier:"CSS", coverage:"" },
  { name:"Sika Armatec 110 epocem", kit:"1.65 gallon", price:263.80, supplier:"", coverage:"" },
  { name:"Sika color pack", kit:"1 bag", price:10.45, supplier:"CSS", coverage:"" },
  { name:"Sika Pro 100-350", kit:"5 gallon", price:275.00, supplier:"Whitecap", coverage:"" },
  { name:"Sika Skim Coat", kit:"10lbs", price:19.79, supplier:"CSS", coverage:"" },
  { name:"Sika VOH", kit:"44lbs", price:32.40, supplier:"CSS", coverage:"" },
  { name:"SIkacolor Elements", kit:"4 pack", price:364.00, supplier:"Whitecap", coverage:"" },
  { name:"TK 290 (Tri siloxane)", kit:"5 gallon", price:195.00, supplier:"CSS", coverage:"200 Sqft/gal" },
  { name:"TK Bright Kure", kit:"5 gallon", price:187.65, supplier:"CSS", coverage:"" },
  { name:"TK Bright Kure", kit:"55 gallon", price:2150.00, supplier:"CSS", coverage:"" },
  { name:"Tremco Dymeric 240FC (warehouse caulk)", kit:"1.5 gallon", price:75.00, supplier:"CSS", coverage:"" },
  { name:"TRU PC NATURAL", kit:"60 lbs", price:45.00, supplier:"Runyon", coverage:"" },
  { name:"Tufflex 6000AL", kit:"5 gallon", price:365.40, supplier:"CSS", coverage:"80-100 Sqft/gal" },
  { name:"Tufflex Primer #2", kit:"2 gallon", price:162.20, supplier:"CSS", coverage:"300-350 Sqft/gal" },
  { name:"Tufflex primer #3", kit:"1.5 gallon", price:143.85, supplier:"CSS", coverage:"300-400 Sqft/gal" },
  { name:"Tufflex RBC", kit:"5 gallon", price:281.00, supplier:"CSS", coverage:"250 Sqft/kit @30 mils" },
  { name:"TX3", kit:"2 gallon", price:150.00, supplier:"High Tec", coverage:"" },
  { name:"TX3 Cartridge", kit:"Cartridge", price:45.00, supplier:"Hi-Tec", coverage:"" },
  { name:"Vocomp 25 (water base acrylic sealer)", kit:"5 gallon", price:180.00, supplier:"Online", coverage:"" },
  { name:"Vocomp30", kit:"5 gallon", price:245.00, supplier:"CSS", coverage:"400 Sqft/gal" },
  { name:"XYPEX", kit:"60lbs", price:210.00, supplier:"CSS", coverage:"" },
];

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDec = fmt; // alias for backward compat
const pct = n => `${(n || 0).toFixed(2)}%`;

// Calc helpers imported from ../lib/calc.js (single source of truth)

// ── Tabs config ────────────────────────────────────────────────────────────
const TABS = [
  { key: "bidding",   label: "1 · Bidding Info", icon: "📋" },
  { key: "labor",     label: "2 · Labor",        icon: "⚒️" },
  { key: "materials", label: "3 · Materials",    icon: "📦" },
  { key: "sow",       label: "4 · Scope of Work",icon: "📝" },
  { key: "travel",    label: "5 · Travel",       icon: "✈️" },
  { key: "discount",  label: "6 · Discount",     icon: "🏷️" },
  { key: "summary",   label: "7 · Summary",      icon: "✅" },
];

// ── Base UI components ─────────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", prefix, suffix, readOnly, highlight, placeholder }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <Label>{label}</Label>}
      <div style={{ position: "relative" }}>
        {prefix && <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.gray400, fontSize: 13, pointerEvents: "none" }}>{prefix}</span>}
        <input
          type={type}
          value={type === "number" ? (value === 0 ? "" : value ?? "") : (value ?? "")}
          onChange={onChange ? (e => onChange(e.target.value)) : undefined}
          readOnly={readOnly}
          placeholder={placeholder}
          style={{
            width: "100%", border: `1.5px solid ${readOnly ? "transparent" : T.gray200}`, borderRadius: 8,
            padding: prefix ? "8px 10px 8px 28px" : "8px 10px", fontSize: 14,
            color: highlight ? T.green : T.gray900, fontWeight: highlight ? 700 : 400,
            background: readOnly ? "rgba(28,24,20,0.08)" : "#bfb3a1", outline: "none",
            boxSizing: "border-box", transition: "border-color 0.15s",
            cursor: readOnly ? "default" : "text", fontFamily: "inherit"
          }}
          onFocus={e => { if (!readOnly) e.target.style.borderColor = T.green; }}
          onBlur={e => { e.target.style.borderColor = T.gray200; }}
        />
        {suffix && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: T.gray400, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Textarea({ label, value, onChange, rows = 4, placeholder, locked }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <Label>{label}</Label>}
      <textarea
        value={value ?? ""}
        onChange={onChange ? (e => onChange(e.target.value)) : undefined}
        rows={rows}
        placeholder={placeholder}
        readOnly={locked}
        style={{
          width: "100%", border: `1.5px solid ${locked ? T.gray100 : T.gray200}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 13, color: T.gray900,
          background: locked ? "rgba(28,24,20,0.08)" : "#bfb3a1", outline: "none", resize: "vertical",
          fontFamily: "inherit", lineHeight: 1.5, boxSizing: "border-box", transition: "border-color 0.15s"
        }}
        onFocus={e => { if (!locked) e.target.style.borderColor = T.green; }}
        onBlur={e => { e.target.style.borderColor = locked ? T.gray100 : T.gray200; }}
      />
    </div>
  );
}

function StatCard({ label, value, green, large }) {
  return (
    <div style={{ background: green ? T.green : T.white, border: `1.5px solid ${green ? T.green : T.gray200}`, borderRadius: 10, padding: "14px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: green ? "rgba(255,255,255,0.7)" : T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: large ? 26 : 18, fontWeight: 700, color: green ? "#ffffff" : T.gray900, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", small, icon, disabled }) {
  const styles = {
    primary:   { background: T.green,  color: T.dark, border: "none" },
    secondary: { background: "#bfb3a1", color: "#1c1814", border: `1.5px solid rgba(28,24,20,0.2)` },
    danger:    { background: T.white,  color: T.red,     border: `1.5px solid ${T.red}` },
    ghost:     { background: "transparent", color: "rgba(255,255,255,0.7)", border: "none" },
    blue:      { background: T.green,   color: T.dark, border: "none" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[variant], borderRadius: 8, padding: small ? "6px 12px" : "9px 18px",
        fontSize: small ? 12 : 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.15s", fontFamily: "inherit"
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.85"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = disabled ? "0.5" : "1"; }}
    >
      {icon && <span>{icon}</span>}{children}
    </button>
  );
}

function SectionHeader({ label, hint, color }) {
  return (
    <div style={{ borderBottom: `2px solid ${color || T.gray200}`, paddingBottom: 8, marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: T.gray900, letterSpacing: "-0.01em" }}>{label}</div>
      {hint && <div style={{ fontSize: 12, color: T.gray400, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function MaterialPicker({ onSelect }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef();

  const results = q.length > 0
    ? MATERIALS_DB.filter(m => (m.name + " " + m.kit).toLowerCase().includes(q.toLowerCase())).slice(0, 12)
    : [];

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Start typing material name…"
        style={{ width: "100%", border: `1.5px solid ${T.green}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", color: T.gray900, background: "#bfb3a1" }}
      />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: T.white, border: `1.5px solid ${T.gray200}`, borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", zIndex: 999, maxHeight: 280, overflowY: "auto", marginTop: 2 }}>
          {results.map((m, i) => (
            <div key={i} onClick={() => { onSelect(m); setQ(""); setOpen(false); }}
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${T.gray100}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, color: T.gray900 }}
              onMouseEnter={e => e.currentTarget.style.background = T.gray50}
              onMouseLeave={e => e.currentTarget.style.background = T.white}
            >
              <span style={{ fontWeight: 500 }}>{m.name}</span>
              <span style={{ fontSize: 11, color: T.gray400, whiteSpace: "nowrap" }}>{m.kit} · {fmt(m.price)} · {m.supplier}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskAutocomplete({ value, onChange, allPriorTasks, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value || "");
  const ref = useRef();

  useEffect(() => { setQ(value || ""); }, [value]);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const matches = q.length > 0
    ? allPriorTasks.filter(t => t.name && t.name.toLowerCase().includes(q.toLowerCase()) && t.name.toLowerCase() !== q.toLowerCase())
    : allPriorTasks.filter(t => t.name && t.name.toLowerCase() !== q.toLowerCase());

  const commit = (task) => { setQ(task.name); onChange(task.name); setOpen(false); };

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input
        value={q}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "#bfb3a1", color: T.gray900 }}
        onBlur={e => e.target.style.borderColor = T.gray200}
      />
      {open && matches.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: T.white, border: `1.5px solid ${T.gray200}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.10)", zIndex: 999, marginTop: 2, overflow: "hidden" }}>
          <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: `1px solid ${T.gray100}`, background: T.gray50 }}>
            TASKS FROM EARLIER DAYS
          </div>
          {matches.map((t, i) => (
            <div key={i} onMouseDown={() => commit(t)}
              style={{ padding: "9px 14px", cursor: "pointer", fontSize: 13, color: T.gray800, borderBottom: i < matches.length - 1 ? `1px solid ${T.gray100}` : "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = T.greenLight}
              onMouseLeave={e => e.currentTarget.style.background = T.white}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: T.green, fontSize: 11, fontWeight: 700 }}>↩</span>
                <span>{t.name}</span>
              </div>
              {t.remaining < 100 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: t.remaining === 0 ? T.red : T.amber, background: t.remaining === 0 ? "#FEE2E2" : "#FFF8E1", padding: "2px 8px", borderRadius: 10, flexShrink: 0 }}>
                  {t.remaining === 0 ? "complete" : `max ${t.remaining}%`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ── Tab components ─────────────────────────────────────────────────────────

function BiddingTab({ data, onChange, workTypes, selectedWorkTypeId, onWorkTypeChange, isFirstWtc, onPwToggle }) {
  const set = k => v => onChange({ ...data, [k]: parseFloat(v) || 0 });
  const pw = data.prevailing_wage;
  const setBurden = v => {
    const rate = parseFloat(v) || 0;
    const auto = !data.ot_overridden;
    if (pw) {
      const pwAuto = !data.pw_ot_overridden;
      onChange({ ...data, pw_rate: rate, pw_ot_rate: pwAuto ? Math.round(rate * 1.5 * 100) / 100 : data.pw_ot_rate });
    } else {
      onChange({ ...data, burden_rate: rate, ot_burden_rate: auto ? Math.round(rate * 1.5 * 100) / 100 : data.ot_burden_rate });
    }
  };
  const setOT = v => {
    if (pw) {
      onChange({ ...data, pw_ot_rate: parseFloat(v) || 0, pw_ot_overridden: true });
    } else {
      onChange({ ...data, ot_burden_rate: parseFloat(v) || 0, ot_overridden: true });
    }
  };
  const rateVal = pw ? (data.pw_rate || 0) : (data.burden_rate || 0);
  const otVal = pw ? (data.pw_ot_rate || 0) : (data.ot_burden_rate || 0);
  const otOverridden = pw ? data.pw_ot_overridden : data.ot_overridden;
  const otIsAuto = !otOverridden && Math.abs(otVal - rateVal * 1.5) < 0.02;

  const setDate = k => v => onChange({ ...data, [k]: v });
  return (
    <div>
      <SectionHeader label="Bidding Information" hint="Rates used to compute all labor costs across this WTC" />
      <div style={{ marginBottom: 14 }}>
        <Label>Work Type</Label>
        <select
          value={selectedWorkTypeId ?? ""}
          onChange={e => onWorkTypeChange(e.target.value)}
          style={{ width: "100%", border: `1.5px solid ${selectedWorkTypeId ? T.gray200 : T.red}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: selectedWorkTypeId ? T.gray900 : T.gray400, background: T.white, outline: "none", fontFamily: "inherit" }}
        >
          <option value="" disabled>Select a work type…</option>
          {workTypes.map(wt => (
            <option key={wt.id} value={wt.id}>{wt.name}</option>
          ))}
        </select>
        {!selectedWorkTypeId && <div style={{ fontSize: 11, color: T.red, marginTop: 3, fontWeight: 600 }}>Required</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 20px", alignItems: "end" }}>
        <Field label={pw ? "PW Rate" : "Burden Rate"} value={rateVal} onChange={setBurden} prefix="$" type="number" />
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <Label>{pw ? "PW OT Rate" : "OT Burden Rate"}</Label>
            {otIsAuto
              ? <span style={{ fontSize: 10, fontWeight: 600, color: T.gray700, letterSpacing: "0.04em" }}>AUTO (1.5×)</span>
              : <button onClick={() => {
                  if (pw) {
                    onChange({ ...data, pw_ot_rate: Math.round((data.pw_rate || 0) * 1.5 * 100) / 100, pw_ot_overridden: false });
                  } else {
                    onChange({ ...data, ot_burden_rate: Math.round(data.burden_rate * 1.5 * 100) / 100, ot_overridden: false });
                  }
                }}
                  style={{ fontSize: 10, fontWeight: 600, color: T.gray400, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                  onMouseEnter={e => e.target.style.color = T.green}
                  onMouseLeave={e => e.target.style.color = T.gray400}>
                  ↺ Reset to 1.5×
                </button>
            }
          </div>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.gray400, fontSize: 13, pointerEvents: "none" }}>$</span>
            <input type="number" value={otVal || ""} onChange={e => setOT(e.target.value)} placeholder="0"
              style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 10px 8px 28px", fontSize: 14, color: T.gray900, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#bfb3a1" }}
              onFocus={e => e.target.style.borderColor = T.green}
              onBlur={e => e.target.style.borderColor = T.gray200} />
          </div>
        </div>
        <Field label="Tax Rate" value={data.tax_rate} onChange={set("tax_rate")} suffix="%" type="number" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px", marginTop: 8 }}>
        <div style={{ marginBottom: 14 }}>
          <Label>Tentative Start Date <span style={{ color: T.red }}>*</span></Label>
          <input type="date" value={data.start_date || ""} onChange={e => setDate("start_date")(e.target.value)}
            onClick={e => e.target.showPicker?.()}
            style={{ width: "100%", border: `1.5px solid ${data.start_date ? T.gray200 : T.red}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.gray900, background: "#bfb3a1", outline: "none", fontFamily: "inherit", boxSizing: "border-box", cursor: "pointer" }}
            onFocus={e => e.target.style.borderColor = T.green}
            onBlur={e => e.target.style.borderColor = data.start_date ? T.gray200 : T.red} />
          {!data.start_date && <div style={{ fontSize: 11, color: T.red, marginTop: 3, fontWeight: 600 }}>Required — use tentative date if unknown</div>}
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Tentative End Date <span style={{ color: T.red }}>*</span></Label>
          <input type="date" value={data.end_date || ""} min={data.start_date || ""} onChange={e => setDate("end_date")(e.target.value)}
            onClick={e => e.target.showPicker?.()}
            style={{ width: "100%", border: `1.5px solid ${data.end_date ? T.gray200 : T.red}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.gray900, background: "#bfb3a1", outline: "none", fontFamily: "inherit", boxSizing: "border-box", cursor: "pointer" }}
            onFocus={e => e.target.style.borderColor = T.green}
            onBlur={e => e.target.style.borderColor = data.end_date ? T.gray200 : T.red} />
          {!data.end_date && <div style={{ fontSize: 11, color: T.red, marginTop: 3, fontWeight: 600 }}>Required — use tentative date if unknown</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: -4, marginBottom: 20, padding: "12px 16px", background: T.gray50, borderRadius: 8, border: `1px solid ${T.gray200}` }}>
        <input type="checkbox" id="pw" checked={data.prevailing_wage || false}
          onChange={e => onPwToggle(e.target.checked)}
          style={{ accentColor: T.green, width: 16, height: 16, cursor: "pointer", WebkitAppearance: "checkbox", appearance: "checkbox" }} />
        <label htmlFor="pw" style={{ fontSize: 13, color: T.gray700, fontWeight: 500, cursor: "pointer" }}>
          Prevailing Wage Job — affects labor rate calculation
        </label>
      </div>
    </div>
  );
}

function LaborTab({ data, bidding, sow, onChange }) {
  const set = k => v => onChange({ ...data, [k]: parseFloat(v) || 0 });
  const effRate = bidding.prevailing_wage ? (bidding.pw_rate || 0) : (bidding.burden_rate || 0);
  const effOtRate = bidding.prevailing_wage ? (bidding.pw_ot_rate || 0) : (bidding.ot_burden_rate || 0);
  const c = calcLabor({ ...data, burden_rate: effRate, ot_burden_rate: effOtRate, size: sow.size });
  return (
    <div>
      <SectionHeader label="Labor" hint="Markup is applied to total labor cost only — not materials" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 20px" }}>
        <Field label="Regular Hours" value={data.regular_hours} onChange={set("regular_hours")} type="number" suffix="hrs" />
        <Field label="Overtime Hours" value={data.ot_hours} onChange={set("ot_hours")} type="number" suffix="hrs" />
        <Field label="Markup %" value={data.markup_pct} onChange={set("markup_pct")} type="number" suffix="%" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
        <StatCard label="Labor Total (billed)" value={fmt(c.total)} green />
      </div>
    </div>
  );
}

function MaterialsTab({ items, taxRate, onChange }) {
  const updateItem = (id, key, val) => onChange(items.map(i => i.id === id ? { ...i, [key]: ["product", "kit_size", "coverage_rate", "supplier"].includes(key) ? val : parseFloat(val) || 0 } : i));
  const removeItem = id => onChange(items.filter(i => i.id !== id));
  const addFromDB = m => onChange([...items, { id: Date.now(), product: m.name, kit_size: m.kit, price_per_unit: m.price, coverage_rate: m.coverage, supplier: m.supplier, qty: 0, tax: taxRate || 0, freight: 0, markup_pct: 0 }]);
  const addCustom = () => onChange([...items, { id: Date.now(), product: "", kit_size: "", price_per_unit: 0, coverage_rate: "", supplier: "", qty: 0, tax: taxRate || 0, freight: 0, markup_pct: 0 }]);

  const totals = items.map(i => calcMaterialRow(i));
  const grandTotal = totals.reduce((s, t) => s + t, 0);
  const subtotal = items.reduce((s, i) => s + (i.price_per_unit || 0) * (i.qty || 0), 0);

  const th = { padding: "8px 6px", textAlign: "left", fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: `1px solid ${T.gray200}` };
  const td = { padding: "6px 4px", fontSize: 12, verticalAlign: "middle" };

  const cellInput = (item, key, type = "number", w = 72) => (
    <td style={{ ...td, width: w }}>
      <input type={type} value={item[key] ?? ""} placeholder={type === "number" ? "0" : ""}
        onChange={e => updateItem(item.id, key, e.target.value)}
        style={{ width: "100%", border: `1px solid ${T.gray200}`, borderRadius: 5, padding: "5px 6px", fontSize: 11, outline: "none", fontFamily: "inherit", boxSizing: "border-box", background: "#bfb3a1" }}
        onFocus={e => e.target.style.borderColor = T.green}
        onBlur={e => e.target.style.borderColor = T.gray200} />
    </td>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <SectionHeader label="Materials" hint="Search the 159-product price list — selecting auto-fills kit size, price, and coverage rate" />
        <span style={{ fontSize: 12, color: T.gray300, fontWeight: 500, marginBottom: 10, whiteSpace: "nowrap", cursor: "default" }}
          title="Coming soon">
          ⚙ Manage price list (coming soon)
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: items.length > 0 ? 4 : 16 }}>
        <MaterialPicker onSelect={addFromDB} />
        <Btn onClick={addCustom} variant="secondary" small>+ Custom</Btn>
      </div>
      {items.length > 0 && (
        <>
          <div style={{ overflowX: "auto", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ background: T.gray50 }}>
                  {["Product", "Kit Size", "Coverage Rate", "Supplier", "$/Unit", "Qty", "Tax %", "Freight", "Markup %", "Total", ""].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${T.gray100}`, background: idx % 2 === 0 ? "rgba(28,24,20,0.04)" : "rgba(28,24,20,0.08)" }}>
                    {cellInput(item, "product", "text", 130)}
                    {cellInput(item, "kit_size", "text", 80)}
                    {cellInput(item, "coverage_rate", "text", 90)}
                    {cellInput(item, "supplier", "text", 80)}
                    {cellInput(item, "price_per_unit", "number", 90)}
                    {cellInput(item, "qty", "number", 55)}
                    {cellInput(item, "tax", "number", 55)}
                    {cellInput(item, "freight", "number", 65)}
                    {cellInput(item, "markup_pct", "number", 65)}
                    <td style={{ ...td, fontWeight: 700, color: T.greenDark, width: 90, fontSize: 13 }}>{fmt(totals[idx])}</td>
                    <td style={{ ...td, width: 32 }}>
                      <button onClick={() => removeItem(item.id)} style={{ background: "none", border: "none", color: T.gray400, cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <StatCard label="Mat. Subtotal" value={fmt(subtotal)} />
            <StatCard label="Mat. Total (w/ tax & markup)" value={fmt(grandTotal)} green />
          </div>
        </>
      )}
    </div>
  );
}

function TravelTab({ data, onChange }) {
  const set = k => v => onChange({ ...data, [k]: parseFloat(v) || 0 });
  const total = calcTravel(data);
  const rowStyle = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginBottom: 4 };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, marginTop: 14 };
  return (
    <div>
      <SectionHeader label="Travel" hint="Each line calculates as rate × quantity" />
      <div style={labelStyle}>🚗 Drive</div>
      <div style={rowStyle}>
        <Field label="$ Per Mile" value={data.drive_rate} onChange={set("drive_rate")} prefix="$" type="number" />
        <Field label="Miles" value={data.drive_miles} onChange={set("drive_miles")} type="number" />
      </div>
      <div style={labelStyle}>✈️ Fly</div>
      <div style={rowStyle}>
        <Field label="$ Per Ticket" value={data.fly_rate} onChange={set("fly_rate")} prefix="$" type="number" />
        <Field label="Tickets" value={data.fly_tickets} onChange={set("fly_tickets")} type="number" />
      </div>
      <div style={labelStyle}>🏨 Stay</div>
      <div style={rowStyle}>
        <Field label="$ Per Night" value={data.stay_rate} onChange={set("stay_rate")} prefix="$" type="number" />
        <Field label="Nights" value={data.stay_nights} onChange={set("stay_nights")} type="number" />
      </div>
      <div style={labelStyle}>🍽️ Per Diem</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px", marginBottom: 4 }}>
        <Field label="$ Per Person/Day" value={data.per_diem_rate} onChange={set("per_diem_rate")} prefix="$" type="number" />
        <Field label="Days" value={data.per_diem_days} onChange={set("per_diem_days")} type="number" />
        <Field label="Crew Count" value={data.per_diem_crew} onChange={set("per_diem_crew")} type="number" />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <div style={{ minWidth: 200 }}><StatCard label="Travel Total" value={fmt(total)} green={total > 0} /></div>
      </div>
    </div>
  );
}

function DiscountTab({ data, onChange }) {
  return (
    <div>
      <SectionHeader label="Discount" hint="Flat dollar discount off the proposal total" />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "0 20px", alignItems: "start" }}>
        <Field label="Discount Amount" value={data.amount} onChange={v => onChange({ ...data, amount: parseFloat(v) || 0 })} prefix="$" type="number" />
        <Field label="Reason" value={data.reason} onChange={v => onChange({ ...data, reason: v })} placeholder="e.g. Repeat customer, competitive bid, bundled scope…" />
      </div>
      {data.amount > 0 && (
        <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B40", borderRadius: 8, padding: "12px 16px", marginTop: 8, fontSize: 13, color: "#92400e" }}>
          ⚠️ {fmt(data.amount)} discount applied to proposal total{data.reason ? ` — ${data.reason}` : ""}
        </div>
      )}
    </div>
  );
}function FieldSowMaterialPicker({ wtcMaterials, selectedMaterials, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const btnRef = useRef();
  const [dropUp, setDropUp] = useState(false);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropUp(window.innerHeight - rect.bottom < 240);
    }
    setOpen(v => !v);
  };

  const safeMaterials = (wtcMaterials || []).filter(m => m && m.id != null);
  const safeName = m => m.product || m.name || "Unnamed material";
  const safeKit  = m => m.kit_size || m.kit || "";
  const safeId   = m => String(m.id);

  const selectedIds = new Set((selectedMaterials || []).map(m => String(m.wtc_material_id)));
  const available   = safeMaterials.filter(m => !selectedIds.has(safeId(m)));

  const addMaterial = m => {
    const entry = {
      wtc_material_id: safeId(m), name: safeName(m), kit_size: safeKit(m),
      qty_planned: 0, mils: 0, coverage_rate: m.coverage || "", mix_time: 0, mix_speed: "", cure_time: ""
    };
    onChange([...(selectedMaterials || []), entry]);
    setOpen(false);
  };

  const removeMaterial = id => onChange((selectedMaterials || []).filter(m => String(m.wtc_material_id) !== String(id)));
  const updateField = (id, key, val) => onChange((selectedMaterials || []).map(m =>
    String(m.wtc_material_id) === String(id) ? { ...m, [key]: val } : m
  ));

  const specInput = (m, key, placeholder, width, type = "text") => (
    <input type={type} value={m[key] ?? ""} placeholder={placeholder}
      onChange={e => updateField(m.wtc_material_id, key, type === "number" ? (parseFloat(e.target.value) || 0) : e.target.value)}
      style={{ width, border: `1.5px solid rgba(28,24,20,0.15)`, borderRadius: 5, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "inherit", background: "#bfb3a1", color: T.gray800, boxSizing: "border-box" }}
      onFocus={e => e.target.style.borderColor = T.green}
      onBlur={e => e.target.style.borderColor = "rgba(28,24,20,0.15)"} />
  );

  return (
    <div style={{ padding: "12px 16px 14px", borderTop: `1px solid rgba(28,24,20,0.12)` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.gray500, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>
        Materials for this day
      </div>
      {(selectedMaterials || []).length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          {(selectedMaterials || []).map(m => (
            <div key={String(m.wtc_material_id)} style={{ background: "rgba(28,24,20,0.04)", border: `1.5px solid rgba(28,24,20,0.15)`, borderRadius: 8, padding: "10px 12px", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.gray900 }}>{m.name}</span>
                  <span style={{ fontSize: 11, color: T.gray400, background: T.gray100, borderRadius: 4, padding: "1px 7px" }}>{m.kit_size}</span>
                </div>
                <button onClick={() => removeMaterial(m.wtc_material_id)}
                  style={{ background: "none", border: "none", color: T.gray300, cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1 }}
                  onMouseEnter={e => e.target.style.color = T.red}
                  onMouseLeave={e => e.target.style.color = T.gray300}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 10px", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Qty Planned</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {specInput(m, "qty_planned", "0", "100%", "number")}
                    <span style={{ fontSize: 11, color: T.gray400, whiteSpace: "nowrap" }}>kits</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Mils</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {specInput(m, "mils", "0", "100%", "number")}
                    <span style={{ fontSize: 11, color: T.gray400 }}>mil</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Coverage Rate</div>
                  {specInput(m, "coverage_rate", "e.g. 200 sqft/gal", "100%")}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 10px" }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Mix Time</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {specInput(m, "mix_time", "0", "100%", "number")}
                    <span style={{ fontSize: 11, color: T.gray400 }}>min</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Mix Speed</div>
                  {specInput(m, "mix_speed", "e.g. Low, Medium", "100%")}
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Cure Time</div>
                  {specInput(m, "cure_time", "e.g. 4 hrs, 24 hrs", "100%")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
        <button ref={btnRef} onClick={handleOpen} disabled={available.length === 0}
          style={{ background: "none", border: `1.5px dashed rgba(28,24,20,0.3)`, borderRadius: 6, padding: "5px 14px", fontSize: 11, fontWeight: 700, color: T.gray800, cursor: available.length === 0 ? "default" : "pointer", fontFamily: "inherit", opacity: available.length === 0 ? 0.4 : 1 }}
          onMouseEnter={e => { if (available.length > 0) e.currentTarget.style.background = "rgba(28,24,20,0.04)"; }}
          onMouseLeave={e => e.currentTarget.style.background = "none"}>
          {available.length === 0 ? "✓ All Tab 3 materials added" : "＋ Add material from this WTC"}
        </button>
        {open && available.length > 0 && (
          <div style={{
            position: "fixed",
            ...(dropUp
              ? { bottom: window.innerHeight - (btnRef.current?.getBoundingClientRect().top ?? 0), top: "auto" }
              : { top: (btnRef.current?.getBoundingClientRect().bottom ?? 0) + 4 }),
            left: btnRef.current?.getBoundingClientRect().left ?? 0,
            background: T.white, border: `1.5px solid ${T.gray200}`, borderRadius: 8,
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)", zIndex: 9999,
            minWidth: 340, maxHeight: 220, overflowY: "auto"
          }}>
            <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: `1px solid ${T.gray100}`, background: T.gray50, position: "sticky", top: 0 }}>
              FROM TAB 3 — THIS WTC ONLY
            </div>
            {available.map((m, i) => (
              <div key={safeId(m)} onMouseDown={() => addMaterial(m)}
                style={{ padding: "10px 14px", cursor: "pointer", borderBottom: i < available.length - 1 ? `1px solid ${T.gray100}` : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(28,24,20,0.06)"}
                onMouseLeave={e => e.currentTarget.style.background = T.white}>
                <span style={{ fontSize: 13, color: T.gray800, fontWeight: 500 }}>{safeName(m)}</span>
                <span style={{ fontSize: 11, color: T.gray400, whiteSpace: "nowrap" }}>{safeKit(m)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SowTab({ data, onChange, locked, wtcMaterials }) {
  const set  = k => v => onChange({ ...data, [k]: v });
  const setN = k => v => onChange({ ...data, [k]: parseFloat(v) || 0 });

  const addSubArea    = () => onChange({ ...data, sub_areas: [...(data.sub_areas || []), { id: Date.now(), label: "", size: 0, unit: "SQFT" }] });
  const removeSubArea = id => onChange({ ...data, sub_areas: (data.sub_areas || []).filter(a => a.id !== id) });
  const updateSubArea = (id, key, val) => onChange({ ...data, sub_areas: (data.sub_areas || []).map(a => a.id === id ? { ...a, [key]: key === "label" || key === "unit" ? val : parseFloat(val) || 0 } : a) });

  const newTask = () => ({ id: Date.now() + Math.random(), description: "", pct_complete: 0 });
  const addDay    = () => onChange({ ...data, field_sow: [...(data.field_sow || []), { id: Date.now(), day_label: `Day ${(data.field_sow || []).length + 1}`, tasks: [newTask()], crew_count: 0, hours_planned: 0, materials: [] }] });
  const removeDay = id => onChange({ ...data, field_sow: (data.field_sow || []).filter(e => e.id !== id) });
  const updateDay = (id, key, val) => onChange({ ...data, field_sow: (data.field_sow || []).map(e => e.id === id ? { ...e, [key]: key === "day_label" ? val : parseFloat(val) || 0 } : e) });
  const addTask    = dayId => onChange({ ...data, field_sow: (data.field_sow || []).map(e => e.id === dayId ? { ...e, tasks: [...(e.tasks || []), newTask()] } : e) });
  const removeTask = (dayId, taskId) => onChange({ ...data, field_sow: (data.field_sow || []).map(e => e.id === dayId ? { ...e, tasks: (e.tasks || []).filter(t => t.id !== taskId) } : e) });
  const updateTask = (dayId, taskId, key, val) => onChange({ ...data, field_sow: (data.field_sow || []).map(e => e.id === dayId ? { ...e, tasks: (e.tasks || []).map(t => t.id === taskId ? { ...t, [key]: key === "description" ? val : parseFloat(val) || 0 } : t) } : e) });
  const updateDayMaterials = (dayId, mats) => onChange({ ...data, field_sow: (data.field_sow || []).map(e => e.id === dayId ? { ...e, materials: mats } : e) });

  const getPriorDayTaskNames = currentDayId => {
    const days = data.field_sow || [];
    const currentIdx = days.findIndex(e => e.id === currentDayId);
    const priorDays  = currentIdx > 0 ? days.slice(0, currentIdx) : [];
    return [...new Set(priorDays.flatMap(e => (e.tasks || []).map(t => t.description)).filter(Boolean))];
  };

  const getCommittedPct = (taskName, currentDayId) =>
    (data.field_sow || [])
      .filter(e => e.id !== currentDayId)
      .flatMap(e => e.tasks || [])
      .filter(t => t.description && t.description.toLowerCase() === taskName.toLowerCase())
      .reduce((s, t) => s + (parseFloat(t.pct_complete) || 0), 0);

  const getRemainingPct  = (taskName, currentDayId) => Math.max(0, 100 - getCommittedPct(taskName, currentDayId));
  const getTaskSuggestions = currentDayId => getPriorDayTaskNames(currentDayId).map(name => ({ name, remaining: getRemainingPct(name, currentDayId) }));

  const UNITS = ["SQFT", "LF", "EA", "HR", "TON", "CY"];
  const unitSelect = (val, onCh, w = 100) => (
    <select value={val || "SQFT"} onChange={e => onCh(e.target.value)}
      style={{ width: w, border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, color: T.gray900, background: "#bfb3a1", outline: "none", fontFamily: "inherit", flexShrink: 0 }}>
      {UNITS.map(u => <option key={u}>{u}</option>)}
    </select>
  );

  return (
    <div>
      <SectionHeader label="Job Metrics" hint="Primary measurement feeds Field Command production tracking" />

      {/* Primary measurement */}
      <div style={{ marginBottom: 10 }}>
        <Label>Primary Measurement</Label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input type="number" value={data.size || ""} placeholder="0"
            onChange={e => onChange({ ...data, size: parseFloat(e.target.value) || 0 })}
            style={{ flex: 1, border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: T.gray900, outline: "none", fontFamily: "inherit", background: "#bfb3a1" }}
            onFocus={e => e.target.style.borderColor = T.green}
            onBlur={e => e.target.style.borderColor = T.gray200} />
          {unitSelect(data.unit, v => onChange({ ...data, unit: v }))}
        </div>
      </div>

      {/* Sub-areas */}
      {(data.sub_areas || []).length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 4, paddingLeft: 2 }}>
          <div style={{ flex: 2, fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase" }}>Sub-area Name</div>
          <div style={{ width: 110, flexShrink: 0, fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase" }}>Size</div>
          <div style={{ width: 100, flexShrink: 0, fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase" }}>Unit</div>
          <div style={{ width: 28 }} />
        </div>
      )}
      {(data.sub_areas || []).map(area => (
        <div key={area.id} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input type="text" value={area.label} placeholder="e.g. Cove Base, Drain Details"
            onChange={e => updateSubArea(area.id, "label", e.target.value)}
            style={{ flex: 2, border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: T.gray900, outline: "none", fontFamily: "inherit", background: "#bfb3a1" }}
            onFocus={e => e.target.style.borderColor = T.green}
            onBlur={e => e.target.style.borderColor = T.gray200} />
          <input type="number" value={area.size || ""} placeholder="Size"
            onChange={e => updateSubArea(area.id, "size", e.target.value)}
            style={{ width: 110, border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: T.gray900, outline: "none", fontFamily: "inherit", flexShrink: 0, background: "#bfb3a1" }}
            onFocus={e => e.target.style.borderColor = T.green}
            onBlur={e => e.target.style.borderColor = T.gray200} />
          {unitSelect(area.unit, v => updateSubArea(area.id, "unit", v))}
          <button onClick={() => removeSubArea(area.id)}
            style={{ background: "none", border: "none", color: T.gray400, cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>×</button>
        </div>
      ))}

      <button onClick={addSubArea}
        style={{ background: "none", border: `1.5px dashed ${T.gray300}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, color: T.gray500, cursor: "pointer", marginBottom: 20, fontFamily: "inherit", display: "block" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = T.green; e.currentTarget.style.color = T.green; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = T.gray300; e.currentTarget.style.color = T.gray500; }}>
        + Add sub-area
      </button>

      {/* Sales SOW — green zone */}
      <div style={{ background: "rgba(28,24,20,0.06)", border: `1px solid rgba(28,24,20,0.15)`, borderRadius: 12, padding: "18px 20px", marginTop: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ background: T.green, color: T.dark, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>🟢 SALES SCOPE</div>
          <span style={{ fontSize: 11, color: T.gray500, fontWeight: 600, letterSpacing: "0.04em" }}>CUSTOMER FACING · GOES ON THE PROPOSAL · LOCKS ON APPROVAL</span>
        </div>
        <Textarea label="Customer-Facing Scope of Work" value={data.sales_sow} onChange={set("sales_sow")} rows={7}
          placeholder={"SCOPE OF WORK:\n- Step 1\n- Step 2\n\nQUALIFICATIONS:\n- ...\n\nEXCLUSIONS:\n- ..."} locked={locked} />
        {locked && <div style={{ fontSize: 11, color: T.green, fontWeight: 600, marginTop: -8 }}>🔒 Locked — change order required to edit</div>}
      </div>

      {/* Field SOW — blue zone */}
      <div style={{ background: "rgba(28,24,20,0.06)", border: `1px solid rgba(28,24,20,0.15)`, borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: T.green, color: T.dark, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>🔵 FIELD SCOPE</div>
            <span style={{ fontSize: 11, color: T.gray500, fontWeight: 600, letterSpacing: "0.04em" }}>CREW FACING · GOES TO FIELD COMMAND · NEVER SEEN BY CUSTOMER</span>
          </div>
          <Btn onClick={addDay} variant="blue" small icon="＋">Add Day Entry</Btn>
        </div>

        {(data.field_sow || []).length === 0 ? (
          <div style={{ background: "rgba(28,24,20,0.06)", borderRadius: 8, padding: "20px", textAlign: "center", color: T.gray500, fontSize: 13, border: `1px dashed rgba(28,24,20,0.3)` }}>
            No day entries yet. Add entries to define the production plan for Field Command.<br />
            <span style={{ fontSize: 11, color: T.gray400 }}>Each entry = one day's tasks, % complete targets, and materials needed</span>
          </div>
        ) : (data.field_sow || []).map((entry) => {
          const tasks = entry.tasks || [];
          return (
            <div key={entry.id} style={{ background: "rgba(28,24,20,0.06)", borderRadius: 10, marginBottom: 12, border: `1px solid rgba(28,24,20,0.15)` }}>
              {/* Day header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid rgba(28,24,20,0.12)`, background: "rgba(28,24,20,0.08)" }}>
                <div style={{ width: 90, flexShrink: 0 }}>
                  <Label>Day Label</Label>
                  <input value={entry.day_label} onChange={e => updateDay(entry.id, "day_label", e.target.value)}
                    style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 6, padding: "5px 8px", fontSize: 13, outline: "none", fontFamily: "inherit", fontWeight: 600, background: "#bfb3a1" }}
                    onFocus={e => e.target.style.borderColor = T.green}
                    onBlur={e => e.target.style.borderColor = T.gray200} />
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <Label>Crew Count</Label>
                  <input type="number" value={entry.crew_count || ""} onChange={e => updateDay(entry.id, "crew_count", e.target.value)}
                    style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 6, padding: "5px 8px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "#bfb3a1" }}
                    onFocus={e => e.target.style.borderColor = T.green}
                    onBlur={e => e.target.style.borderColor = T.gray200} />
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <Label>Hours Planned</Label>
                  <input type="number" value={entry.hours_planned || ""} onChange={e => updateDay(entry.id, "hours_planned", e.target.value)}
                    style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 6, padding: "5px 8px", fontSize: 13, outline: "none", fontFamily: "inherit", background: "#bfb3a1" }}
                    onFocus={e => e.target.style.borderColor = T.green}
                    onBlur={e => e.target.style.borderColor = T.gray200} />
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => removeDay(entry.id)}
                  style={{ background: "none", border: "none", color: T.gray300, cursor: "pointer", fontSize: 18, padding: "0 4px", lineHeight: 1, flexShrink: 0 }}
                  onMouseEnter={e => e.target.style.color = T.red}
                  onMouseLeave={e => e.target.style.color = T.gray300}>×</button>
              </div>

              {/* Tasks */}
              <div style={{ padding: "10px 16px 4px" }}>
                {tasks.map((task, ti) => {
                  const committed = getCommittedPct(task.description, entry.id);
                  const cap       = task.description ? getRemainingPct(task.description, entry.id) : 100;
                  const isKnown   = committed > 0;
                  const isOver    = isKnown && (parseFloat(task.pct_complete) || 0) > cap;
                  return (
                    <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.gray800, minWidth: 20, textAlign: "right", flexShrink: 0 }}>{ti + 1}.</span>
                      <TaskAutocomplete
                        value={task.description}
                        onChange={val => updateTask(entry.id, task.id, "description", val)}
                        allPriorTasks={getTaskSuggestions(entry.id)}
                        placeholder={ti === 0 ? "Describe task…" : `Task ${ti + 1} description`}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                        <input type="number" value={task.pct_complete || ""} placeholder="0"
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            if (isKnown && val > cap) return;
                            updateTask(entry.id, task.id, "pct_complete", e.target.value);
                          }}
                          style={{ width: 64, border: `1.5px solid ${isOver ? T.red : isKnown ? T.green : T.gray200}`, borderRadius: 6, padding: "6px 8px", fontSize: 13, outline: "none", fontFamily: "inherit", textAlign: "center", background: "#bfb3a1", color: T.gray900 }}
                          onFocus={e => e.target.style.borderColor = isOver ? T.red : T.green}
                          onBlur={e => e.target.style.borderColor = isOver ? T.red : isKnown ? T.green : T.gray200} />
                        <span style={{ fontSize: 12, color: T.gray400, fontWeight: 600 }}>%</span>
                        {isKnown && cap < 100 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: cap === 0 ? T.red : T.green, whiteSpace: "nowrap", marginLeft: 2 }}>
                            {cap === 0 ? "done" : `max ${cap}%`}
                          </span>
                        )}
                      </div>
                      <button onClick={() => removeTask(entry.id, task.id)}
                        style={{ background: "none", border: "none", color: tasks.length > 1 ? T.gray300 : "transparent", cursor: tasks.length > 1 ? "pointer" : "default", fontSize: 16, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
                        onMouseEnter={e => { if (tasks.length > 1) e.target.style.color = T.red; }}
                        onMouseLeave={e => e.target.style.color = tasks.length > 1 ? T.gray300 : "transparent"}>×</button>
                    </div>
                  );
                })}
              </div>

              {/* Add task */}
              <div style={{ padding: "4px 16px 12px" }}>
                <button onClick={() => addTask(entry.id)}
                  style={{ background: "none", border: `1.5px dashed rgba(28,24,20,0.3)`, borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 700, color: T.gray800, cursor: "pointer", fontFamily: "inherit", opacity: 0.8 }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "0.8"}>
                  ＋ Add Task
                </button>
              </div>

              {/* Day materials */}
              <FieldSowMaterialPicker
                wtcMaterials={wtcMaterials}
                selectedMaterials={entry.materials || []}
                onChange={mats => updateDayMaterials(entry.id, mats)}
              />
            </div>
          );
        })}
        {(data.field_sow || []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Btn onClick={addDay} variant="blue" small icon="＋">Add Day Entry</Btn>
          </div>
        )}
      </div>
    </div>
  );
}function Summary({ labor, materials, travel, discount, size, unit }) {
  const laborTotal   = labor.total || 0;
  const matTotal     = materials.reduce((s, i) => s + calcMaterialRow(i), 0);
  const matsCost     = materials.reduce((s, i) => {
    const price = parseFloat(i.price_per_unit) || 0;
    const qty = parseFloat(i.qty) || 0;
    const base = price * qty;
    const tax = base * ((parseFloat(i.tax) || 0) / 100);
    const freight = parseFloat(i.freight) || 0;
    return s + base + tax + freight;
  }, 0);
  const travelTotal  = calcTravel(travel);
  const discountAmt  = discount.amount || 0;
  const subtotal     = laborTotal + matTotal + travelTotal;
  const proposalPrice = Math.ceil(subtotal - discountAmt);
  const totalCost     = (labor.subtotal || 0) + matsCost + travelTotal;
  const profitDollars = proposalPrice - totalCost;
  const profitMargin  = proposalPrice > 0 ? (profitDollars / proposalPrice) * 100 : 0;
  const sqftPrice     = (size || 0) > 0 ? proposalPrice / size : 0;

  return (
    <div style={{ background: T.dark, borderRadius: 14, padding: "24px 28px", marginTop: 0, border: "1px solid rgba(48,207,172,0.2)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
        WTC Summary
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 2fr", gap: 12 }}>
        {[
          { label: `${unit || "Sqft"} Price`, value: fmtDec(sqftPrice) },
          { label: "Labor Cost",              value: fmt(labor.subtotal || 0) },
          { label: "Profit Margin",           value: pct(profitMargin) },
          { label: "Proposal Price",          value: fmt(proposalPrice), large: true },
        ].map(({ label, value, large }) => (
          <div key={label} style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: large ? 28 : 18, fontWeight: 700, color: "white", letterSpacing: "-0.02em" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {[
          { label: "Labor",     value: fmt(laborTotal) },
          { label: "Materials", value: fmt(matTotal) },
          { label: "Travel",    value: fmt(travelTotal) },
          { label: "Discount",  value: discountAmt ? `-${fmt(discountAmt)}` : "$0.00" },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "rgba(0,0,0,0.15)", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
            <span style={{ fontSize: 13, color: "white", fontWeight: 700 }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryTab({ labor, materials, travel, discount, sow, bidding, onSave, saved, locked, onLock, onGeneratePDF }) {
  const laborTotal    = labor.total || 0;
  const matTotal      = materials.reduce((s, i) => s + calcMaterialRow(i), 0);
  const matsCost      = materials.reduce((s, i) => {
    const price = parseFloat(i.price_per_unit) || 0;
    const qty = parseFloat(i.qty) || 0;
    const base = price * qty;
    const tax = base * ((parseFloat(i.tax) || 0) / 100);
    const freight = parseFloat(i.freight) || 0;
    return s + base + tax + freight;
  }, 0);
  const travelTotal   = calcTravel(travel);
  const discountAmt   = discount.amount || 0;
  const proposalPrice = Math.ceil(laborTotal + matTotal + travelTotal - discountAmt);
  const totalCost     = (labor.subtotal || 0) + matsCost + travelTotal;
  const profitDollars = proposalPrice - totalCost;
  const profitMargin  = proposalPrice > 0 ? (profitDollars / proposalPrice) * 100 : 0;
  const sqftPrice     = (sow.size || 0) > 0 ? proposalPrice / sow.size : 0;

  const [sowExpanded,   setSowExpanded]   = useState(true);
  const [fieldExpanded, setFieldExpanded] = useState(false);

  const lineItem = (label, value, sub, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "11px 0", borderBottom: `1px solid ${T.gray100}` }}>
      <span style={{ fontSize: 14, color: sub ? T.gray500 : T.gray700, fontWeight: sub ? 400 : 500, paddingLeft: sub ? 12 : 0 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: color || T.gray900, letterSpacing: "-0.01em" }}>{value}</span>
    </div>
  );

  return (
    <div>
      <SectionHeader label="WTC Summary" hint="Review all figures before saving or locking this Work Type Calculator" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

        {/* LEFT — Financial breakdown */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12 }}>Financial Breakdown</div>
          <div style={{ background: T.gray50, borderRadius: 10, border: `1px solid ${T.gray200}`, padding: "4px 16px" }}>
            {lineItem("Labor Subtotal (cost)", fmt(labor.subtotal || 0), true)}
            {lineItem("Labor Markup",          fmt(labor.markupAmt || 0), true)}
            {lineItem("Labor Total (billed)",  fmt(laborTotal))}
            {lineItem("Materials Total",       fmt(matTotal))}
            {lineItem("Travel Total",          fmt(travelTotal))}
            {discountAmt > 0 && lineItem("Discount", `-${fmt(discountAmt)}`, false, T.amber)}
            {lineItem("Subtotal", fmt(laborTotal + matTotal + travelTotal))}
          </div>
          <div style={{ marginTop: 12, background: T.dark, borderRadius: 10, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid rgba(48,207,172,0.3)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Proposal Price</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "white", letterSpacing: "-0.02em" }}>{fmt(proposalPrice)}</div>
          </div>
          <div style={{ marginTop: 12, background: T.gray50, borderRadius: 10, border: `1px solid ${T.gray200}`, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>{sow.unit || "Sqft"} Price</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.gray900 }}>{fmtDec(sqftPrice)}</div>
              <div style={{ fontSize: 11, color: T.gray400, marginTop: 6 }}>Profit margin: {pct(profitMargin)}</div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.gray400, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10 }}>Job Metrics</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { label: "Primary Size",     value: `${(sow.size || 0).toLocaleString()} ${sow.unit || "SQFT"}` },
                { label: "Field Plan Days",  value: (sow.field_sow || []).length > 0 ? `${(sow.field_sow || []).length} day entries` : "No day plan yet" },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: T.gray50, borderRadius: 8, padding: "10px 14px", border: `1px solid ${T.gray200}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.gray400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.gray900 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — SOW Preview + Actions */}
        <div>
          {/* Sales SOW */}
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => setSowExpanded(v => !v)}
              style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ background: T.green, color: T.dark, borderRadius: 5, padding: "2px 9px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>🟢 SALES SCOPE</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.gray400, letterSpacing: "0.04em" }}>CUSTOMER FACING</span>
              </div>
              <span style={{ fontSize: 12, color: T.gray400, fontWeight: 600 }}>{sowExpanded ? "▲ collapse" : "▼ expand"}</span>
            </button>
            {sowExpanded && (
              <div style={{ background: T.greenLight, border: `2px solid ${T.green}40`, borderRadius: 10, padding: "14px 16px" }}>
                {sow.sales_sow
                  ? <pre style={{ margin: 0, fontSize: 12, color: T.gray700, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{sow.sales_sow}</pre>
                  : <div style={{ fontSize: 13, color: T.gray400, fontStyle: "italic" }}>No Sales SOW written yet — add it in the Scope of Work tab.</div>
                }
                {locked && <div style={{ fontSize: 11, color: T.green, fontWeight: 600, marginTop: 10 }}>🔒 Locked</div>}
              </div>
            )}
          </div>

          {/* Field SOW */}
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setFieldExpanded(v => !v)}
              style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ background: T.green, color: T.dark, borderRadius: 5, padding: "2px 9px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>🔵 FIELD SCOPE</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.gray400, letterSpacing: "0.04em" }}>{(sow.field_sow || []).length} DAY ENTRIES</span>
              </div>
              <span style={{ fontSize: 12, color: T.gray400, fontWeight: 600 }}>{fieldExpanded ? "▲ collapse" : "▼ expand"}</span>
            </button>
            {fieldExpanded && (
              <div style={{ background: "rgba(28,24,20,0.06)", border: `1px solid rgba(28,24,20,0.15)`, borderRadius: 10, padding: "14px 16px" }}>
                {(sow.field_sow || []).length === 0
                  ? <div style={{ fontSize: 13, color: T.gray400, fontStyle: "italic" }}>No day entries yet.</div>
                  : (sow.field_sow || []).map((entry, i) => {
                    const tasks      = entry.tasks || [];
                    const entryMats  = entry.materials || [];
                    return (
                      <div key={entry.id} style={{ borderBottom: i < sow.field_sow.length - 1 ? `1px solid rgba(28,24,20,0.12)` : "none", paddingBottom: 10, marginBottom: 10 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.gray900, minWidth: 48 }}>{entry.day_label || `Day ${i + 1}`}</span>
                          <span style={{ fontSize: 11, color: T.gray400 }}>{entry.crew_count || 0} crew · {entry.hours_planned || 0} hrs</span>
                          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: T.gray500 }}>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
                        </div>
                        {tasks.map((t, ti) => (
                          <div key={t.id} style={{ display: "flex", gap: 6, fontSize: 12, color: T.gray600, paddingLeft: 48, marginBottom: 2 }}>
                            <span style={{ color: T.gray500, fontWeight: 600 }}>{ti + 1}.</span>
                            <span style={{ flex: 1 }}>{t.description || <em style={{ color: T.gray400 }}>No description</em>}</span>
                            <span style={{ color: T.green, fontWeight: 700, flexShrink: 0, background: T.dark, borderRadius: 6, padding: "1px 7px", fontSize: 11 }}>{t.pct_complete || 0}%</span>
                          </div>
                        ))}
                        {entryMats.length > 0 && (
                          <div style={{ paddingLeft: 48, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {entryMats.map((m, mi) => (
                              <span key={mi} style={{ fontSize: 10, background: "rgba(28,24,20,0.08)", color: T.gray600, borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>
                                {m.name}{m.qty_planned > 0 ? ` × ${m.qty_planned}` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                }
              </div>
            )}
          </div>

          {/* 3-Step Action Flow */}
          <div style={{ background: T.gray50, border: `1px solid ${T.gray200}`, borderRadius: 12, padding: "20px 20px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 18 }}>Proposal Actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

              {/* Step 1 — Lock & Approve */}
              <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: locked ? "#FFF3E0" : T.white, border: `2px solid ${locked ? T.amber : T.gray300}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: locked ? T.amber : T.gray400 }}>1</span>
                  </div>
                  <div style={{ width: 2, flex: 1, background: T.gray200, minHeight: 16, marginTop: 2, marginBottom: 2 }} />
                </div>
                <div style={{ flex: 1, paddingBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: locked ? T.amber : T.gray400, marginBottom: 6, letterSpacing: "0.03em" }}>INTERNAL APPROVAL</div>
                  <button onClick={onLock}
                    style={{ width: "100%", background: locked ? "#FFF8E1" : T.green, color: locked ? T.amber : T.dark, border: locked ? `2px solid ${T.amber}` : "none", borderRadius: 8, padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit", transition: "all 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                    {locked ? "🔓 Unlock WTC" : "🔒 Lock & Approve WTC"}
                  </button>
                  
                </div>
              </div>

              {/* Step 3 — Generate PDF */}
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: locked ? "#E3F2FD" : T.white, border: `2px solid ${locked ? T.green : T.gray300}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: locked ? T.green : T.gray400 }}>2</span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: locked ? T.green : T.gray400, marginBottom: 6, letterSpacing: "0.03em" }}>GENERATE & SEND</div>
                  <button disabled={!locked} onClick={locked ? onGeneratePDF : undefined}
                    style={{ width: "100%", background: locked ? T.green : T.white, color: locked ? T.dark : T.gray400, border: `2px solid ${locked ? T.green : T.gray200}`, borderRadius: 8, padding: "13px 16px", fontSize: 14, fontWeight: 700, cursor: locked ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit", transition: "all 0.15s", opacity: locked ? 1 : 0.4, boxShadow: locked ? `0 2px 10px ${T.green}35` : "none" }}
                    onMouseEnter={e => { if (locked) e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={e => e.currentTarget.style.opacity = locked ? "1" : "0.4"}>
                    📄 Generate Proposal PDF
                  </button>
                  {!locked && <div style={{ fontSize: 11, color: T.gray400, marginTop: 5, paddingLeft: 2 }}>Lock & Approve first to enable</div>}
                  {locked && <div style={{ fontSize: 11, color: T.green, fontWeight: 600, marginTop: 5, paddingLeft: 2 }}>✓ Ready — PDF will include locked Sales SOW</div>}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}function PDFPreviewModal({ open, onClose, proposal }) {
  const [view, setView] = useState("preview");
  const [sendDone, setSendDone] = useState(false);

  useEffect(() => {
    if (!open) { setView("preview"); setSendDone(false); }
  }, [open]);

  if (!open) return null;

  const { labor, materials, travel, discount, sow, proposalNumber, jobInfo = {} } = proposal;
  const matTotal      = (materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const travelTotal   = calcTravel(travel || {});
  const proposalPrice = Math.ceil((labor.total || 0) + matTotal + travelTotal - ((discount || {}).amount || 0));
  const today         = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, address: "" });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, address: [cfg.address, cfg.city, cfg.state, cfg.zip].filter(Boolean).join(", ") }));
  }, []);

  const S = {
    page:        { background: "#ffffff", fontFamily: "'Inter', sans-serif", color: "#1c1814" },
    topBar:      { padding: "24px 36px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "4px solid #30cfac" },
    topBarLeft:  { fontSize: 20, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.01em" },
    topBarRight: { textAlign: "right", fontSize: 11, color: "#6b6358", lineHeight: 1.8 },
    tealBar:     { background: "#30cfac", height: 4 },
    body:        { padding: "32px 36px" },
    metaRow:     { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, paddingBottom: 24, borderBottom: "1.5px solid #e8e3de" },
    metaLeft:    { fontSize: 13, color: "#4a4238", lineHeight: 1.9 },
    metaRight:   { textAlign: "right" },
    label:       { fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 },
    propNum:     { fontSize: 13, fontWeight: 700, color: "#1c1814" },
    preparedHdr: { fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 },
    preparedVal: { fontSize: 14, fontWeight: 700, color: "#1c1814", marginBottom: 2 },
    preparedSub: { fontSize: 12, color: "#4a4238", lineHeight: 1.7 },
    sowHdr:      { fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 },
    sowBox:      { border: "1.5px solid #e8e3de", borderRadius: 8, padding: "20px 24px", marginBottom: 32 },
    sowText:     { margin: 0, fontSize: 13, color: "#2d2720", lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "inherit" },
    totalRow:    { display: "flex", justifyContent: "space-between", alignItems: "center", border: "2px solid #30cfac", borderRadius: 10, padding: "18px 24px", marginBottom: 32 },
    totalLabel:  { fontSize: 13, fontWeight: 700, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase" },
    totalAmt:    { fontSize: 28, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.02em" },
    sigGrid:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, paddingTop: 24, borderTop: "1.5px solid #e8e3de" },
    sigLabel:    { fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 40 },
    sigLine:     { borderBottom: "1.5px solid #6b6358", marginBottom: 6 },
    sigSub:      { fontSize: 10, color: "#887c6e" },
    validity:    { fontSize: 11, color: "#887c6e", textAlign: "center", marginTop: 24, fontStyle: "italic" },
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.75)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "white", borderRadius: 16, width: "min(780px,95vw)", maxHeight: "93vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.4)", overflow: "hidden" }}>

        {/* Modal chrome */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e8e3de", background: "#faf9f7", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: "#1c1814", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#30cfac", fontSize: 15 }}>📄</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>Proposal Preview</div>
              <div style={{ fontSize: 11, color: "#887c6e" }}>{jobInfo.customerName || "Customer"}{proposalNumber ? ` · Proposal #${proposalNumber}` : ""}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "preview" && !sendDone && (
              <>
                <button onClick={() => window.print()} style={{ background: "none", border: "1.5px solid #e8e3de", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4a4238", cursor: "pointer", fontFamily: "inherit" }}>🖨 Print</button>
                <button onClick={() => setView("send")} style={{ background: "#30cfac", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "#1c1814", cursor: "pointer", fontFamily: "inherit" }}>📨 Send to Customer →</button>
              </>
            )}
            {view === "send" && !sendDone && (
              <button onClick={() => setView("preview")} style={{ background: "none", border: "1.5px solid #e8e3de", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4a4238", cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#887c6e", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto" }}>

          {view === "preview" && (
            <div style={S.page}>
              {/* Header — printer friendly */}
              <div style={S.topBar}>
                <div>
                  <div style={S.topBarLeft}>{COMPANY.name}</div>
                  <div style={{ fontSize: 11, color: "#6b6358", marginTop: 2 }}>{COMPANY.tagline}</div>
                </div>
                <div style={S.topBarRight}>
                  <div>{COMPANY.address}</div>
                  <div>{COMPANY.phone} · {COMPANY.email}</div>
                  <div>{COMPANY.license}</div>
                </div>
              </div>


              <div style={S.body}>
                {/* Meta row — Prepared For + Proposal # + Date */}
                <div style={S.metaRow}>
                  <div>
                    <div style={S.preparedHdr}>Prepared For</div>
                    <div style={S.preparedVal}>{jobInfo.customerName || "—"}</div>
                    {jobInfo.customerAddress && <div style={S.preparedSub}>{jobInfo.customerAddress}</div>}
                    {jobInfo.jobsiteAddress && (
                      <div style={{ marginTop: 14 }}>
                        <div style={S.preparedHdr}>Jobsite Address</div>
                        <div style={S.preparedSub}>{jobInfo.jobsiteAddress}</div>
                      </div>
                    )}
                  </div>
                  <div style={S.metaRight}>
                    {proposalNumber && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={S.label}>Proposal #</div>
                        <div style={S.propNum}>{proposalNumber}</div>
                      </div>
                    )}
                    <div>
                      <div style={S.label}>Date</div>
                      <div style={S.propNum}>{today}</div>
                    </div>
                  </div>
                </div>

                {/* Scope of Work */}
                <div style={{ marginBottom: 28 }}>
                  <div style={S.sowHdr}>Scope of Work</div>
                  <div style={S.sowBox}>
                    {sow.sales_sow
                      ? <pre style={S.sowText}>{sow.sales_sow}</pre>
                      : <div style={{ fontSize: 13, color: "#887c6e", fontStyle: "italic" }}>No scope of work written yet.</div>
                    }
                  </div>
                </div>

                {/* Total price */}
                <div style={S.totalRow}>
                  <div style={S.totalLabel}>PROPOSAL TOTAL</div>
                  <div style={S.totalAmt}>{fmt(proposalPrice)}</div>
                </div>

                {/* Signature block */}
                <div style={S.sigGrid}>
                  <div>
                    <div style={S.sigLabel}>Customer Acceptance</div>
                    <div style={S.sigLine} />
                    <div style={S.sigSub}>Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
                    <div style={{ ...S.sigLine, marginTop: 28 }} />
                    <div style={S.sigSub}>Printed Name</div>
                  </div>

                </div>

                <div style={S.validity}>*This proposal is valid for 90 days from the date above.*</div>
              </div>
            </div>
          )}

          {view === "send" && !sendDone && (
            <div style={{ padding: "32px", maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1c1814", marginBottom: 6 }}>Send Proposal to Customer</div>
              <div style={{ fontSize: 13, color: "#887c6e", marginBottom: 24 }}>Select the contact who will receive and sign this proposal.</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Select Recipient</div>
              <div style={{ background: "#faf9f7", border: "1.5px solid #e8e3de", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#887c6e", fontStyle: "italic" }}>
                Recipients will be pulled from the linked customer record. Wire-up coming in SC-30.
              </div>
              <button onClick={() => setSendDone(true)}
                style={{ width: "100%", background: "#30cfac", color: "#1c1814", border: "none", borderRadius: 8, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                📨 Send Proposal
              </button>
            </div>
          )}

          {sendDone && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1c1814", marginBottom: 8 }}>Proposal Sent</div>
              <div style={{ fontSize: 14, color: "#887c6e", marginBottom: 24 }}>The customer will receive an email with a link to review and sign.</div>
              <Btn onClick={onClose} variant="secondary">Close</Btn>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function CustomerSigningPage({ proposal, onClose }) {
  const [name, setName] = useState("");
  const [signed, setSigned] = useState(false);

  const { labor, materials, travel, discount, sow } = proposal;
  const matTotal      = (materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const travelTotal   = Object.values(travel || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const proposalPrice = Math.ceil((labor.total || 0) + matTotal + travelTotal - ((discount || {}).amount || 0));

  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email }));
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: T.gray50, fontFamily: "'DM Sans', sans-serif", paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ background: T.gray100, borderBottom: `1px solid ${T.gray200}`, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.gray900 }}>{COMPANY.name}</div>
          <div style={{ fontSize: 12, color: T.gray500 }}>{COMPANY.tagline}</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.green }}>{fmt(proposalPrice)}</div>
      </div>

      <div style={{ maxWidth: 680, margin: "32px auto", padding: "0 20px" }}>

        {/* Proposal card */}
        <div style={{ background: T.white, borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "28px 32px", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.gray400, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Scope of Work</div>
          {sow.sales_sow
            ? <pre style={{ margin: 0, fontSize: 13, color: T.gray700, lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{sow.sales_sow}</pre>
            : <div style={{ fontSize: 13, color: T.gray400, fontStyle: "italic" }}>No scope of work provided.</div>
          }
        </div>

        {/* Price breakdown */}
        <div style={{ background: T.white, borderRadius: 14, border: `1px solid ${T.gray200}`, padding: "20px 28px", marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.gray700 }}>Total Investment</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: T.green, letterSpacing: "-0.02em" }}>{fmt(proposalPrice)}</div>
          </div>
        </div>

        {/* Signing */}
        {!signed ? (
          <div style={{ background: T.white, borderRadius: 14, border: `2px solid ${T.green}`, padding: "28px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.gray900, marginBottom: 6 }}>Accept & Sign</div>
            <div style={{ fontSize: 13, color: T.gray500, marginBottom: 20 }}>Type your full name below to electronically sign and accept this proposal.</div>
            <div style={{ marginBottom: 16 }}>
              <Label>Full Name</Label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name"
                style={{ width: "100%", border: `1.5px solid ${T.gray200}`, borderRadius: 8, padding: "10px 14px", fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                onFocus={e => e.target.style.borderColor = T.green}
                onBlur={e => e.target.style.borderColor = T.gray200} />
            </div>
            {name.trim().length > 2 && (
              <div style={{ marginBottom: 16, padding: "14px 18px", background: "#F0F4FF", borderRadius: 8, border: `1px solid ${T.green}30` }}>
                <div style={{ fontSize: 11, color: T.gray400, marginBottom: 6 }}>Signature preview</div>
                <div style={{ fontSize: 38, color: "#1E40AF", fontFamily: "'Great Vibes', cursive" }}>{name}</div>
              </div>
            )}
            <button onClick={() => { if (name.trim().length > 2) setSigned(true); }} disabled={name.trim().length <= 2}
              style={{ width: "100%", background: name.trim().length > 2 ? T.green : T.gray200, color: name.trim().length > 2 ? T.dark : T.gray400, border: "none", borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 700, cursor: name.trim().length > 2 ? "pointer" : "default", fontFamily: "inherit", transition: "all 0.2s", marginBottom: 12 }}>
              {name.trim().length > 2 ? `✍️ Accept & Sign as "${name}"` : "Type your name above to sign"}
            </button>
            <div style={{ fontSize: 11, color: T.gray400, textAlign: "center", lineHeight: 1.6 }}>
              By signing you agree this constitutes a legal electronic signature.<br />Timestamp and IP address will be recorded.
            </div>
          </div>
        ) : (
          <div style={{ background: T.white, borderRadius: 14, border: `2px solid ${T.green}`, padding: "40px 32px", textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.gray900, marginBottom: 8 }}>Proposal Accepted</div>
            <div style={{ fontSize: 38, color: "#1E40AF", fontFamily: "'Great Vibes', cursive", marginBottom: 16 }}>{name}</div>
            <div style={{ fontSize: 13, color: T.gray500, marginBottom: 24 }}>Thank you! Your signature has been recorded. You'll receive a confirmation email shortly.</div>
            {onClose && <Btn onClick={onClose} variant="secondary">Close</Btn>}
          </div>
        )}
      </div>
    </div>
  );
}
// ── Load Great Vibes font for signing ─────────────────────────────────────
const gvLink = document.createElement("link");
gvLink.rel = "stylesheet";
gvLink.href = "https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap";
document.head.appendChild(gvLink);

// ── Main WTC Calculator ────────────────────────────────────────────────────
export default function WTCCalculator({ proposalId, wtcId: wtcIdProp, workTypeId, onClose, onBackToList, initialTab }) {
  // ── Full-bleed layout: remove parent padding so WTC fills content area ──
  useEffect(() => {
    const content = document.querySelector("[data-app-content]");
    if (content) {
      content.style.padding = "0";
      content.style.overflowY = "hidden";
    }
    return () => {
      if (content) {
        content.style.padding = "28px 32px";
        content.style.overflowY = "auto";
      }
    };
  }, []);

  const [tab,        setTab]      = useState(initialTab || "bidding");
  const [wtcId, setWtcId] = useState(wtcIdProp);
  const [locked,     setLocked]   = useState(false);
  const [saved,      setSaved]    = useState(!!wtcIdProp);
  const autosaveTimer = useRef(null);
  const [workTypes,  setWorkTypes] = useState([]);
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState(workTypeId ?? null);
  const [bidding,  setBidding]  = useState({ burden_rate: DEFAULTS.default_burden_rate, ot_burden_rate: DEFAULTS.default_ot_burden_rate, tax_rate: DEFAULTS.default_tax_rate, prevailing_wage: false, ot_overridden: false, start_date: "", end_date: "" });
  const [labor,    setLabor]    = useState({ regular_hours: 0, ot_hours: 0, markup_pct: 0 });
  const [materials,setMaterials]= useState([]);
  const [sow,      setSow]      = useState({ size: 0, unit: "SQFT", sales_sow: "", field_sow: [] });
  const [travel,   setTravel]   = useState({ drive_rate: 0, drive_miles: 0, fly_rate: 0, fly_tickets: 0, stay_rate: 0, stay_nights: 0, per_diem_rate: 0, per_diem_days: 0, per_diem_crew: 0 });
  const [discount, setDiscount] = useState({ amount: 0, reason: "" });

  const effRate = bidding.prevailing_wage ? (bidding.pw_rate || 0) : (bidding.burden_rate || 0);
  const effOtRate = bidding.prevailing_wage ? (bidding.pw_ot_rate || 0) : (bidding.ot_burden_rate || 0);
  const laborComputed = calcLabor({ ...labor, burden_rate: effRate, ot_burden_rate: effOtRate, size: sow.size });

  // ── Autosave ─────────────────────────────────────────────────────────────
  const isLoading = useRef(true);
  useEffect(() => { isLoading.current = false; }, []);
  useEffect(() => {
    if (isLoading.current) return;
    if (proposalSold) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { handleSave(); }, 1500);
    return () => clearTimeout(autosaveTimer.current);
  }, [bidding, labor, materials, sow, travel, discount]);

  // ── Load tenant defaults for new WTCs ───────────────────────────────────
  useEffect(() => {
    if (wtcId) return;
    getTenantConfig().then(cfg => {
      setBidding(b => ({ ...b, burden_rate: cfg.default_burden_rate, ot_burden_rate: cfg.default_ot_burden_rate, tax_rate: cfg.default_tax_rate }));
    });
  }, []);

  // ── Load from Supabase on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!wtcId) return;
    async function loadWTC() {
      const { data, error } = await supabase
        .from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("id", wtcId)
        .single();
      if (error || !data) return;
      const cfg = await getTenantConfig();
      setBidding({
        burden_rate:     data.burden_rate     ?? cfg.default_burden_rate,
        ot_burden_rate:  data.ot_burden_rate  ?? cfg.default_ot_burden_rate,
        tax_rate:        data.tax_rate        ?? cfg.default_tax_rate,
        prevailing_wage: data.prevailing_wage ?? false,
        ot_overridden:   false,
        pw_rate:         data.pw_rate         ?? 0,
        pw_ot_rate:      data.pw_ot_rate      ?? 0,
        pw_ot_overridden: false,
      });
      setLabor({
        regular_hours: data.regular_hours ?? 0,
        ot_hours:      data.ot_hours      ?? 0,
        markup_pct:    data.markup_pct    ?? 0,
      });
      setMaterials(data.materials ?? []);
      setSow({
        size:      data.size      ?? 0,
        unit:      data.unit      ?? "SQFT",
        sales_sow: data.sales_sow ?? "",
        field_sow: data.field_sow ?? [],
        sub_areas: data.sub_areas ?? [],
      });
      setTravel({
        drive_rate:    (data.travel ?? {}).drive_rate    ?? 0,
        drive_miles:   (data.travel ?? {}).drive_miles   ?? 0,
        fly_rate:      (data.travel ?? {}).fly_rate      ?? 0,
        fly_tickets:   (data.travel ?? {}).fly_tickets   ?? 0,
        stay_rate:     (data.travel ?? {}).stay_rate     ?? 0,
        stay_nights:   (data.travel ?? {}).stay_nights   ?? 0,
        per_diem_rate: (data.travel ?? {}).per_diem_rate ?? 0,
        per_diem_days: (data.travel ?? {}).per_diem_days ?? 0,
        per_diem_crew: (data.travel ?? {}).per_diem_crew ?? 0,

      });
      setDiscount({
        amount: data.discount ?? 0,
        reason: data.discount_reason ?? "",
      });
      setLocked(data.locked ?? false);
      setBidding(prev => ({ ...prev, start_date: data.start_date ?? "", end_date: data.end_date ?? "" }));
      if (data.work_type_id) setSelectedWorkTypeId(data.work_type_id);
      setSaved(true);
    }
    loadWTC();
  }, [wtcId]);

  // ── Determine WTC order + auto-fill PW from siblings ─────────────────────
  useEffect(() => {
    if (!proposalId) return;
    async function checkSiblings() {
      const { data: siblings } = await supabase
        .from("proposal_wtc")
        .select("id, prevailing_wage, pw_rate, pw_ot_rate")
        .eq("proposal_id", proposalId)
        .order("created_at", { ascending: true });
      if (!siblings || siblings.length === 0) { setIsFirstWtc(true); setWtcNumber(1); return; }
      const first = siblings[0];
      setIsFirstWtc(!wtcId || first.id === wtcId);
      const idx = wtcId ? siblings.findIndex(s => s.id === wtcId) : siblings.length;
      setWtcNumber(idx >= 0 ? idx + 1 : siblings.length + 1);
      // Auto-fill PW for new WTCs (no wtcId yet) if a sibling has PW on
      if (!wtcId) {
        const pwSibling = siblings.find(s => s.prevailing_wage);
        if (pwSibling) {
          setBidding(b => ({ ...b, prevailing_wage: true, pw_rate: pwSibling.pw_rate || 0, pw_ot_rate: pwSibling.pw_ot_rate || 0 }));
        }
      }
    }
    checkSiblings();
  }, [proposalId, wtcId]);

  // ── Load work types for dropdown ─────────────────────────────────────────
  useEffect(() => {
    async function loadWorkTypes() {
      const { data } = await supabase
        .from("work_types")
        .select("id, name")
        .order("name");
      if (data) setWorkTypes(data);
    }
    loadWorkTypes();
  }, []);

  // ── Auto-load SOW template when work type selected ───────────────────────
  const handleWorkTypeChange = async (newWorkTypeId) => {
    setSelectedWorkTypeId(newWorkTypeId);
    if (!sow.sales_sow) {
      const { data } = await supabase
        .from("work_type_sow_templates")
        .select("sales_sow_template")
        .eq("work_type_id", newWorkTypeId)
        .single();
      if (data?.sales_sow_template) {
        setSow(s => ({ ...s, sales_sow: data.sales_sow_template }));
      }
    }
  };

  // ── PW toggle handler ────────────────────────────────────────────────────
  const handlePwToggle = (checked) => {
    if (checked) {
      // Turning PW on — always allowed
      setBidding(b => ({ ...b, prevailing_wage: true, pw_ot_overridden: false }));
      setSaved(false);
    } else {
      // Turning PW off
      if (!isFirstWtc) {
        setPwAlert("To remove Prevailing Wage, go to WTC 1 — it will be removed from all WTCs on this proposal.");
        return;
      }
      // WTC 1 — confirm removal from all
      if (!window.confirm("This will remove Prevailing Wage from ALL WTCs on this proposal. Continue?")) return;
      setBidding(b => ({ ...b, prevailing_wage: false, pw_ot_overridden: false }));
      setSaved(false);
    }
  };

  // ── Save to Supabase ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!proposalId) return;
    if (!selectedWorkTypeId) return;
    const payload = {
      proposal_id:     proposalId,
      work_type_id:    selectedWorkTypeId ?? null,
      burden_rate:     bidding.burden_rate,
      ot_burden_rate:  bidding.ot_burden_rate,
      tax_rate:        bidding.tax_rate,
      prevailing_wage: bidding.prevailing_wage,
      pw_rate:         bidding.pw_rate || 0,
      pw_ot_rate:      bidding.pw_ot_rate || 0,
      regular_hours:   labor.regular_hours,
      ot_hours:        labor.ot_hours,
      markup_pct:      labor.markup_pct,
      materials:       materials,
      size:            sow.size,
      unit:            sow.unit,
      sales_sow:       sow.sales_sow,
      field_sow:       sow.field_sow,
      sub_areas:       sow.sub_areas ?? [],
      travel:          travel,
      discount:        discount.amount,
      discount_reason: discount.reason,
      start_date:      bidding.start_date || null,
      end_date:        bidding.end_date || null,
      locked:          locked,
    };
    if (wtcId) {
      await supabase.from("proposal_wtc").update(payload).eq("id", wtcId);
    } else {
      const { data: newRow } = await supabase.from("proposal_wtc").insert(payload).select().single();
      if (newRow?.id) setWtcId(newRow.id);
    }
    // Sync prevailing_wage + rates to all sibling WTCs on this proposal
    if (proposalId) {
      await supabase.from("proposal_wtc")
        .update({
          prevailing_wage: bidding.prevailing_wage,
          pw_rate: bidding.pw_rate || 0,
          pw_ot_rate: bidding.pw_ot_rate || 0,
        })
        .eq("proposal_id", proposalId)
        .neq("id", wtcId);
    }
    // Update proposals.total by summing ALL WTCs for this proposal
    if (proposalId) {
      const { data: allWtcs } = await supabase.from("proposal_wtc").select("*").eq("proposal_id", proposalId);
      const proposalTotal = (allWtcs || []).reduce((sum, w) => sum + calcWtcTotal(w), 0);
      await supabase.from("proposals").update({ total: proposalTotal }).eq("id", proposalId);
    }
    setSaved(true);
  };

  // ── Lock in Supabase ─────────────────────────────────────────────────────
  const handleLock = async () => {
    // Flush any unsaved changes before toggling lock
    await handleSave();
    const newLocked = !locked;
    setLocked(newLocked);
    if (wtcId) {
      await supabase.from("proposal_wtc").update({ locked: newLocked }).eq("id", wtcId);
    }
    // Sync proposals.total on lock/unlock — sum ALL WTCs
    if (proposalId) {
      const { data: allWtcs } = await supabase.from("proposal_wtc").select("*").eq("proposal_id", proposalId);
      const proposalTotal = (allWtcs || []).reduce((sum, w) => sum + calcWtcTotal(w), 0);
      await supabase.from("proposals").update({ total: proposalTotal }).eq("id", proposalId);
    }
  };
  const [showPDF,     setShowPDF]     = useState(false);
  const [showSigning, setShowSigning] = useState(false);
  const [proposalNumber, setProposalNumber] = useState(null);
  const [jobInfo, setJobInfo] = useState({ customerName: "", jobsiteAddress: "", customerAddress: "", jobName: "", displayJobNumber: "" });
  const [proposalSold, setProposalSold] = useState(false);
  const [isFirstWtc, setIsFirstWtc] = useState(true);
  const [wtcNumber, setWtcNumber] = useState(null);
  const [pwAlert, setPwAlert] = useState(null);

  useEffect(() => {
    if (!proposalId) return;
    async function loadJobInfo() {
      const { data } = await supabase
        .from("proposals")
        .select("proposal_number, customer, status, call_log(job_name, display_job_number, jobsite_address, jobsite_city, jobsite_state, jobsite_zip, customer_id, customers(business_address, business_city, business_state, business_zip))")
        .eq("id", proposalId)
        .single();
      if (data?.proposal_number) setProposalNumber(data.proposal_number);
      if (data?.status === "Sold") setProposalSold(true);
      if (data) {
        const cl = data.call_log;
        const cust = cl?.customers;
        setJobInfo({
          customerName: data.customer || "",
          jobName: cl?.job_name || "",
          displayJobNumber: cl?.display_job_number || "",
          customerAddress: [cust?.business_address, cust?.business_city, cust?.business_state, cust?.business_zip].filter(Boolean).join(", "),
          jobsiteAddress: [cl?.jobsite_address, cl?.jobsite_city, cl?.jobsite_state, cl?.jobsite_zip].filter(Boolean).join(", "),
        });
      }
    }
    loadJobInfo();
  }, [proposalId]);
  const proposalData = { labor: laborComputed, materials, travel, discount, sow, proposalNumber, jobInfo };

  const tabs = TABS.map(t => t.key);
  const idx = tabs.indexOf(tab);

  // ── Print helpers ──────────────────────────────────────────────────────────
  const workTypeName = workTypes.find(w => w.id === selectedWorkTypeId)?.name || "—";
  const printLaborComputed = laborComputed;
  const printMatTotal = materials.reduce((s, i) => s + calcMaterialRow(i), 0);
  const printMatsCost = materials.reduce((s, i) => {
    const price = parseFloat(i.price_per_unit) || 0;
    const qty = parseFloat(i.qty) || 0;
    const base = price * qty;
    const tax = base * ((parseFloat(i.tax) || 0) / 100);
    const freight = parseFloat(i.freight) || 0;
    return s + base + tax + freight;
  }, 0);
  const printTravelTotal = calcTravel(travel);
  const printDiscountAmt = discount.amount || 0;
  const printSubtotal = (printLaborComputed.total || 0) + printMatTotal + printTravelTotal;
  const printProposalPrice = Math.ceil(printSubtotal - printDiscountAmt);
  const printTotalCost = (printLaborComputed.subtotal || 0) + printMatsCost + printTravelTotal;
  const printProfitDollars = printProposalPrice - printTotalCost;
  const printProfitMargin = printProposalPrice > 0 ? (printProfitDollars / printProposalPrice) * 100 : 0;
  const printSqftPrice = (sow.size || 0) > 0 ? printProposalPrice / sow.size : 0;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: T.gray50, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Fixed nav arrows — pinned just outside the content card */}
      {idx > 0 && (
        <button data-wtc-no-print onClick={() => setTab(tabs[idx - 1])}
          style={{ position: "fixed", top: "50%", left: "calc(50% + 90px - 520px)", transform: "translateY(-50%)", zIndex: 50, width: 44, height: 44, borderRadius: "50%", border: `2px solid ${T.green}`, background: T.dark, color: T.green, fontSize: 18, fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", padding: 0, lineHeight: 1, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
          ←
        </button>
      )}
      {idx < tabs.length - 1 && (
        <button data-wtc-no-print onClick={() => setTab(tabs[idx + 1])}
          style={{ position: "fixed", top: "50%", left: "calc(50% + 90px + 490px)", transform: "translateY(-50%)", zIndex: 50, width: 44, height: 44, borderRadius: "50%", border: `2px solid ${T.green}`, background: T.green, color: T.dark, fontSize: 18, fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", padding: 0, lineHeight: 1, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
          →
        </button>
      )}
      {/* Print stylesheet */}
      <style>{`
        @media print {
          body, html { background: white !important; margin: 0 !important; padding: 0 !important; }
          [data-app-shell] { display: block !important; height: auto !important; overflow: visible !important; }
          [data-app-sidebar] { display: none !important; }
          [data-app-header] { display: none !important; }
          [data-app-content] { overflow: visible !important; height: auto !important; padding: 0 !important; }
          [data-app-content] > div { display: block !important; overflow: visible !important; height: auto !important; }
          [data-wtc-no-print] { display: none !important; }
          [data-wtc-print-only] { display: block !important; }
          div { box-shadow: none !important; }
          @page { margin: 0.5in; size: letter; }
        }
        @media screen {
          [data-wtc-print-only] { display: none !important; }
        }
      `}</style>

      {/* Sticky header + tab bar wrapper */}
      <div data-wtc-no-print style={{ flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.2)", background: T.dark }}>
        {/* Header */}
        <div style={{ background: T.dark, borderBottom: `1px solid rgba(255,255,255,0.08)`, padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500, marginBottom: 3 }}>
              Sales Command · Proposals /
              <span style={{ color: T.green, fontWeight: 600 }}> WTC</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ffffff", letterSpacing: "-0.02em" }}>Work Type Calculator{wtcNumber ? ` — WTC ${wtcNumber}` : ""}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Btn onClick={() => window.print()} variant="secondary" small icon="🖨">Print</Btn>
            {onBackToList && <Btn onClick={onBackToList} variant="secondary" small>← Proposals</Btn>}
            {onClose && <Btn onClick={() => onClose()} variant="ghost">✕ Close</Btn>}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ background: T.dark, borderBottom: `1px solid rgba(255,255,255,0.08)`, padding: "0 28px", display: "flex", gap: 0, overflowX: "auto", overflowY: "hidden" }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "13px 16px", fontSize: 13, fontWeight: active ? 700 : 500, color: active ? T.green : "rgba(255,255,255,0.5)", borderBottom: active ? `2px solid ${T.green}` : "2px solid transparent", marginBottom: -1, display: "flex", alignItems: "center", gap: 6, transition: "color 0.15s", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 14 }}>{t.icon}</span>{t.label}
            </button>
          );
        })}
      </div>
      </div>

      {/* Content area */}
      <div data-wtc-no-print style={{ flex: 1, overflowY: "auto", paddingBottom: 60 }}>
      <div style={{ maxWidth: 940, margin: "0 auto", padding: "28px 20px" }}>
        {(locked || proposalSold) && tab !== "summary" && (
          <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>🔒</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>{proposalSold ? "This proposal is Sold — WTC is read-only" : "This WTC is locked"}</div>
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 2 }}>Go to the Summary tab and click Unlock WTC to make edits.</div>
            </div>
          </div>
        )}
        {pwAlert && (
          <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>&#9888;</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>{pwAlert}</span>
            </div>
            <button onClick={() => setPwAlert(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#92400e", fontWeight: 700, padding: "0 4px" }}>&times;</button>
          </div>
        )}
        <div style={{ background: "#c8bcaa", borderRadius: 14, border: `1px solid rgba(28,24,20,0.15)`, padding: "28px 32px", marginBottom: 20, position: "relative" }}>
          {(locked || proposalSold) && tab !== "summary" && (
            <div style={{ position: "absolute", inset: 0, borderRadius: 14, zIndex: 10, cursor: "not-allowed" }} onClick={() => {}} />
          )}
          {tab === "bidding" && <BiddingTab data={bidding} onChange={proposalSold ? undefined : v => { setBidding(v); setSaved(false); }} workTypes={workTypes} selectedWorkTypeId={selectedWorkTypeId} onWorkTypeChange={proposalSold ? undefined : handleWorkTypeChange} isFirstWtc={isFirstWtc} onPwToggle={proposalSold ? () => {} : handlePwToggle} />}
          {tab === "labor"   && <LaborTab data={labor} bidding={bidding} sow={sow} onChange={proposalSold ? undefined : v => { setLabor(v); setSaved(false); }} />}
          {tab === "materials" && <MaterialsTab items={materials} taxRate={bidding.tax_rate} onChange={proposalSold ? undefined : v => { setMaterials(v); setSaved(false); }} />}
          {tab === "sow"     && <SowTab data={sow} onChange={v => { setSow(v); setSaved(false); }} locked={locked} wtcMaterials={materials} />}
          {tab === "travel"  && <TravelTab data={travel} onChange={proposalSold ? undefined : v => { setTravel(v); setSaved(false); }} />}
          {tab === "discount" && <DiscountTab data={discount} onChange={proposalSold ? undefined : v => { setDiscount(v); setSaved(false); }} />}
          {tab === "summary" && <SummaryTab labor={laborComputed} materials={materials} travel={travel} discount={discount} sow={sow} bidding={bidding} onSave={handleSave} saved={saved} locked={locked} onLock={handleLock} onGeneratePDF={() => { if (onClose) onClose(true); }} />}
        </div>
<Summary labor={laborComputed} materials={materials} travel={travel} discount={discount} size={sow.size} unit={sow.unit} />

      </div>
      </div>
      {/* ── Print-only layout ──────────────────────────────────────────────── */}
      <div data-wtc-print-only style={{ padding: "24px 40px", fontFamily: "'Inter', sans-serif", color: "#1c1814", fontSize: 12 }}>
        {/* Print header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #30cfac", paddingBottom: 14, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>Work Type Calculator</div>
            <div style={{ fontSize: 13, color: "#6b6358", marginTop: 4 }}>{workTypeName}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "#6b6358" }}>
            {jobInfo.displayJobNumber && <div style={{ fontWeight: 700, fontSize: 13, color: "#1c1814" }}>{jobInfo.displayJobNumber}</div>}
            {jobInfo.customerName && <div>{jobInfo.customerName}</div>}
            <div>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
          </div>
        </div>

        {/* Bidding info */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b6358", marginBottom: 6 }}>Bidding Info</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 8px", color: "#6b6358" }}>Burden Rate</td>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{fmt(bidding.burden_rate)}/hr</td>
                <td style={{ padding: "4px 8px", color: "#6b6358" }}>OT Rate</td>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{fmt(bidding.ot_burden_rate)}/hr</td>
                <td style={{ padding: "4px 8px", color: "#6b6358" }}>Tax Rate</td>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{pct(bidding.tax_rate)}</td>
              </tr>
              {bidding.prevailing_wage && (
                <tr>
                  <td style={{ padding: "4px 8px", color: "#6b6358" }}>PW Rate</td>
                  <td style={{ padding: "4px 8px", fontWeight: 600 }}>{fmt(bidding.pw_rate)}/hr</td>
                  <td style={{ padding: "4px 8px", color: "#6b6358" }}>PW OT Rate</td>
                  <td style={{ padding: "4px 8px", fontWeight: 600 }}>{fmt(bidding.pw_ot_rate)}/hr</td>
                  <td colSpan={2} />
                </tr>
              )}
              <tr>
                <td style={{ padding: "4px 8px", color: "#6b6358" }}>Size</td>
                <td style={{ padding: "4px 8px", fontWeight: 600 }}>{(sow.size || 0).toLocaleString()} {sow.unit || "SQFT"}</td>
                {bidding.start_date && <><td style={{ padding: "4px 8px", color: "#6b6358" }}>Start</td><td style={{ padding: "4px 8px", fontWeight: 600 }}>{bidding.start_date}</td></>}
                {bidding.end_date && <><td style={{ padding: "4px 8px", color: "#6b6358" }}>End</td><td style={{ padding: "4px 8px", fontWeight: 600 }}>{bidding.end_date}</td></>}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Labor breakdown */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b6358", marginBottom: 6 }}>Labor Breakdown</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e0d8" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Item</th>
                <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Hours</th>
                <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Rate</th>
                <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                <td style={{ padding: "6px 8px" }}>Regular Hours</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{labor.regular_hours}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(effRate)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(printLaborComputed.regularCost)}</td>
              </tr>
              {labor.ot_hours > 0 && (
                <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                  <td style={{ padding: "6px 8px" }}>Overtime Hours</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{labor.ot_hours}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(effOtRate)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(printLaborComputed.otCost)}</td>
                </tr>
              )}
              <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                <td style={{ padding: "6px 8px" }}>Subtotal (cost)</td>
                <td colSpan={2} />
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(printLaborComputed.subtotal)}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                <td style={{ padding: "6px 8px" }}>Markup ({labor.markup_pct}%)</td>
                <td colSpan={2} />
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(printLaborComputed.markupAmt)}</td>
              </tr>
              <tr style={{ borderBottom: "2px solid #1c1814" }}>
                <td style={{ padding: "6px 8px", fontWeight: 700 }}>Labor Total (billed)</td>
                <td colSpan={2} />
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmt(printLaborComputed.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Materials list */}
        {materials.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b6358", marginBottom: 6 }}>Materials</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e0d8" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Material</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Unit Price</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Tax</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Freight</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Markup</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e5e0d8" }}>
                    <td style={{ padding: "6px 8px" }}>{m.product || m.name || "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{m.qty || 0}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(m.price_per_unit)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{pct(m.tax)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(m.freight)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{pct(m.markup_pct)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(calcMaterialRow(m))}</td>
                  </tr>
                ))}
                <tr style={{ borderBottom: "2px solid #1c1814" }}>
                  <td colSpan={6} style={{ padding: "6px 8px", fontWeight: 700 }}>Materials Total</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmt(printMatTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Travel */}
        {printTravelTotal > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#6b6358", marginBottom: 6 }}>Travel</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e0d8" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>Category</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Rate</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Qty</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 700 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {travel.drive_rate > 0 && travel.drive_miles > 0 && (
                  <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                    <td style={{ padding: "6px 8px" }}>Drive</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(travel.drive_rate)}/mi</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{travel.drive_miles} mi</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(travel.drive_rate * travel.drive_miles)}</td>
                  </tr>
                )}
                {travel.fly_rate > 0 && travel.fly_tickets > 0 && (
                  <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                    <td style={{ padding: "6px 8px" }}>Fly</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(travel.fly_rate)}/ticket</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{travel.fly_tickets}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(travel.fly_rate * travel.fly_tickets)}</td>
                  </tr>
                )}
                {travel.stay_rate > 0 && travel.stay_nights > 0 && (
                  <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                    <td style={{ padding: "6px 8px" }}>Lodging</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(travel.stay_rate)}/night</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{travel.stay_nights}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(travel.stay_rate * travel.stay_nights)}</td>
                  </tr>
                )}
                {travel.per_diem_rate > 0 && travel.per_diem_days > 0 && (
                  <tr style={{ borderBottom: "1px solid #e5e0d8" }}>
                    <td style={{ padding: "6px 8px" }}>Per Diem</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt(travel.per_diem_rate)}/person/day</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{travel.per_diem_days}d x {travel.per_diem_crew} crew</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(travel.per_diem_rate * travel.per_diem_days * travel.per_diem_crew)}</td>
                  </tr>
                )}
                <tr style={{ borderBottom: "2px solid #1c1814" }}>
                  <td colSpan={3} style={{ padding: "6px 8px", fontWeight: 700 }}>Travel Total</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, fontSize: 13 }}>{fmt(printTravelTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Discount */}
        {printDiscountAmt > 0 && (
          <div style={{ marginBottom: 18, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px", background: "#FFF8E1", borderRadius: 6 }}>
              <span style={{ fontWeight: 600 }}>Discount{discount.reason ? ` — ${discount.reason}` : ""}</span>
              <span style={{ fontWeight: 700 }}>-{fmt(printDiscountAmt)}</span>
            </div>
          </div>
        )}

        {/* Summary totals */}
        <div style={{ borderTop: "3px solid #30cfac", paddingTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <tr><td style={{ padding: "5px 8px", color: "#6b6358" }}>Labor</td><td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(printLaborComputed.total)}</td></tr>
              <tr><td style={{ padding: "5px 8px", color: "#6b6358" }}>Materials</td><td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(printMatTotal)}</td></tr>
              <tr><td style={{ padding: "5px 8px", color: "#6b6358" }}>Travel</td><td style={{ padding: "5px 8px", textAlign: "right" }}>{fmt(printTravelTotal)}</td></tr>
              {printDiscountAmt > 0 && <tr><td style={{ padding: "5px 8px", color: "#92400e" }}>Discount</td><td style={{ padding: "5px 8px", textAlign: "right", color: "#92400e" }}>-{fmt(printDiscountAmt)}</td></tr>}
              <tr style={{ borderTop: "2px solid #1c1814" }}>
                <td style={{ padding: "8px 8px", fontWeight: 800, fontSize: 16 }}>Proposal Price</td>
                <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 800, fontSize: 16 }}>{fmt(printProposalPrice)}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px", color: "#6b6358", fontSize: 12 }}>{sow.unit || "Sqft"} Price</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 12 }}>{fmtDec(printSqftPrice)}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px", color: "#6b6358", fontSize: 12 }}>Profit Margin</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 12 }}>{pct(printProfitMargin)}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px", color: "#6b6358", fontSize: 12 }}>Total Cost</td>
                <td style={{ padding: "4px 8px", textAlign: "right", fontSize: 12 }}>{fmt(printTotalCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    {showPDF && <PDFPreviewModal open={showPDF} onClose={() => setShowPDF(false)} proposal={proposalData} />}
      {showSigning && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, overflowY: "auto" }}>
          <CustomerSigningPage proposal={proposalData} onClose={() => setShowSigning(false)} />
        </div>
      )}
    </div>
  );
}