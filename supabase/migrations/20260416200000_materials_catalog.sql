-- Materials catalog: per-tenant reusable material price list.
-- System defaults (tenant_id NULL) are readable by all tenants; tenant rows
-- are editable only by their tenant. The WTC MaterialPicker merges both,
-- tenant rows winning on (name, kit_size) collision so a tenant can override
-- pricing by re-adding under the same name + kit size.

CREATE TABLE IF NOT EXISTS public.materials_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid
    REFERENCES public.tenant_config(id) ON DELETE CASCADE,
  name text NOT NULL,
  kit_size text,
  price numeric NOT NULL DEFAULT 0,
  coverage text,
  supplier text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_catalog_tenant_id
  ON public.materials_catalog(tenant_id);

CREATE INDEX IF NOT EXISTS idx_materials_catalog_name
  ON public.materials_catalog(name);

DROP TRIGGER IF EXISTS trg_materials_catalog_updated_at ON public.materials_catalog;
CREATE TRIGGER trg_materials_catalog_updated_at
  BEFORE UPDATE ON public.materials_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.materials_catalog ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant rows + system defaults (NULL tenant visible to all)
DROP POLICY IF EXISTS materials_catalog_select ON public.materials_catalog;
CREATE POLICY materials_catalog_select ON public.materials_catalog
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS materials_catalog_insert ON public.materials_catalog;
CREATE POLICY materials_catalog_insert ON public.materials_catalog
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS materials_catalog_update ON public.materials_catalog;
CREATE POLICY materials_catalog_update ON public.materials_catalog
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS materials_catalog_delete ON public.materials_catalog;
CREATE POLICY materials_catalog_delete ON public.materials_catalog
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- ---------------------------------------------------------------------------
-- Seed system defaults (tenant_id NULL) from the former hardcoded
-- MATERIALS_DB in src/pages/WTCCalculator.jsx. Guarded so re-runs no-op.
-- ---------------------------------------------------------------------------
DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.materials_catalog WHERE tenant_id IS NULL) THEN
    INSERT INTO public.materials_catalog (tenant_id, name, kit_size, price, coverage, supplier) VALUES
    (NULL, 'Aerosil (cabosil)', '22lbs', 448.90, '', 'CSS'),
    (NULL, 'Aerosil (cabosil) Key resins', '20lbs', 221.18, '', 'Key Resins'),
    (NULL, 'Ameripolish dye', '1 gallon', 69.00, '', 'Runyon'),
    (NULL, 'Ardex Ardifix', 'Cartridge', 51.68, '', 'Tom Duffy'),
    (NULL, 'Ardex CD Fine', '20lbs', 46.93, '50 Sqft/bag', 'Tom Duffy'),
    (NULL, 'Ardex Concrete Guard', '1 gallon', 94.65, '200 Sqft/gal', 'Tom Duffy'),
    (NULL, 'Ardex CP', '40lbs', 48.43, '', 'Tom Duffy'),
    (NULL, 'Ardex EP2000', '10 lbs', 178.27, '150-200 Sqft/unit', 'Tom Duffy'),
    (NULL, 'Ardex feather finish', '25lbs', 21.00, '', 'Tom Duffy'),
    (NULL, 'Ardex K525', '50lbs', 44.75, '', 'Tom Duffy'),
    (NULL, 'Ardex MRF', '10 lbs', 17.06, '', 'Tom Duffy'),
    (NULL, 'Ardex PCT', '50 Lbs', 52.31, '', 'Tom Duffy'),
    (NULL, 'Ardex SDM Gray', '10lbs', 35.65, '', 'Tom Duffy'),
    (NULL, 'Ardex SDM White', '10lbs', 37.90, '', 'Tom Duffy'),
    (NULL, 'Armorhard (epoxy sand patch)', '5 gallon', 150.00, '', 'CSS'),
    (NULL, 'Armorseal 8100', '1 gallon', 125.82, '', 'Sherwin Williams'),
    (NULL, 'Armorseal 8100', '5 gallon', 486.00, '', 'Sherwin Williams'),
    (NULL, 'Ashford (densifier/sealer)', '55 gallons', 563.75, '', 'CureCrete'),
    (NULL, 'Backer Rod 1/4"', '6400 LF', 137.25, '', 'CSS'),
    (NULL, 'Backer Rod 3/8"', '3600 LF', 156.55, '', 'CSS'),
    (NULL, 'Backer Rod 7/8', '850 LF', 45.00, '', 'CSS'),
    (NULL, 'Ballistix', '1 gallon', 329.00, '800-1100 Sqft/gal', ''),
    (NULL, 'Basf 400', '5 gallon', 185.00, '', 'CSS'),
    (NULL, 'Cohill Metallics', '1.5 gallon', 40.00, '', 'CSS'),
    (NULL, 'Colored chips (flake)', '55lbs', 125.00, '.15 lbs/Sqft', 'CSS/Westcoat/RPM'),
    (NULL, 'Colored Quartz', '55lbs', 42.00, '500 lbs/1000 Sqft', 'CSS/Sika/Key Resins'),
    (NULL, 'Crown 320 (100 solids)', '3 gallon', 172.50, '', ''),
    (NULL, 'Crown 7072sc (polyaspartic)', '2 gallon', 228.50, '', 'CSS'),
    (NULL, 'Crown 7072sc (polyaspartic)', '10 gallon', 1135.00, '', 'CSS'),
    (NULL, 'Crown 8175 (Polyaspartic) One day garage', '2 gallon', 195.00, '', 'CSS'),
    (NULL, 'Crown 8202 Water Base Epoxy', '1.25 gallon', 71.55, '', 'CSS'),
    (NULL, 'Crown 8202 Water Base Epoxy', '5 gallon', 275.35, '', 'CSS'),
    (NULL, 'Crown 8240 (Polyurea Coating)', '3 gallon', 162.00, '', 'CSS'),
    (NULL, 'Crown 8303 MVB', '3 gallon', 314.35, '100 Sqft/gal', 'CSS'),
    (NULL, 'Crown 8312 (cove gel)', '3 gallon', 276.10, '', 'CSS'),
    (NULL, 'Crown 8340 (Polyaspartic long working)', '3 gallon', 315.00, '', ''),
    (NULL, 'Crown color pack', '1 quart', 48.00, '', 'CSS'),
    (NULL, 'Dal Coating (Line Striping Paint)', '5 gallon', 245.00, '320LF/gal', 'Home Depot'),
    (NULL, 'Dex-o-tex 1p primer', '2.9 gallon', 330.60, '', 'Dex-o-tex'),
    (NULL, 'Dex-o-tex AeroFlor', '2 gallon', 260.00, '', 'Dex-o-tex'),
    (NULL, 'Dex-O-Tex AJ44', '5 gallon', 300.00, '', 'Dex-o-Tex'),
    (NULL, 'Dex-o-tex Decoflor (100 solids epoxy)', '3 gallon', 183.00, '', 'Dex-o-tex'),
    (NULL, 'Dex-o-tex Dexothane CRU (MATTE)', '2.5 gallon', 508.00, '', 'Dex-o-tex'),
    (NULL, 'Dex-o-tex Positred (100 solids Epoxy)', '3 gallon', 225.00, '', 'Dex-o-tex'),
    (NULL, 'Dex-o-tex Quikglaze (Polyaspartic)', '3 gallon', 435.00, '', 'Dex-o-tex'),
    (NULL, 'Dex-o-tex W/B dex o cote (Water base)', '2 gallon', 143.00, '', 'Dex-o-tex'),
    (NULL, 'Dex-o-tex weather seal xl (Acrylic)', '5 gallon', 220.00, '', 'Dex-o-tex'),
    (NULL, 'EP-90', '10 gallon', 500.00, '45 LF/unit', 'High Tec'),
    (NULL, 'Euclid Diamond Hard', '5 gallon', 110.00, '', 'CSS'),
    (NULL, 'Euclid Eucosil', '5 gallon', 50.00, '', 'CSS'),
    (NULL, 'Euclid stain (UV stable)', '1 gallon', 44.10, '', 'CSS'),
    (NULL, 'Fine Mesh Fabric', '300 LF', 18.00, '', ''),
    (NULL, 'Flex set (warehouse patch)', '5 gallon', 117.00, '', 'CSS'),
    (NULL, 'Flowfresh SL', 'double pack', 126.40, '63 Sqft/kit', 'Key Resins Direct'),
    (NULL, 'Flowfresh SR sealer', '1.5 gallon', 80.51, '120 Sqft/kit', 'Key Resins Direct'),
    (NULL, 'Galaxy foam (panel joint backer rod)', '600 LF', 225.00, '', 'CSS'),
    (NULL, 'GE Elemax 2600 (Weather proofing)', '5 gallon', 490.00, '', 'CSS'),
    (NULL, 'GE Elemax 5000 (Liquid Flashing)', '20oz Sausage', 12.53, '', 'CSS'),
    (NULL, 'GE Silpruf SCS2000 (Caulking)', '20oz Sausage', 14.50, '', 'CSS'),
    (NULL, 'H&C Infusion dye', '1 gallon', 70.00, '', ''),
    (NULL, 'Hi-Tech PE85 (polyurea joint filler)', '10 gallon', 500.00, '', 'Hi-Tec'),
    (NULL, 'Hi-Tech PE90 (polyurea joint filler)', '10 gallon', 500.00, '', 'High Tec'),
    (NULL, 'High tech TX3', '2 gallon', 150.00, '', 'Hi-Tec'),
    (NULL, 'Key 520 Pigmented', '3 Gallon', 194.70, '', 'Key Resins Direct'),
    (NULL, 'Key Resin Flowfresh PA', '15 gallon', 1516.67, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 445 W/B Matte urethane', '1.25 gallon', 122.63, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 450 (Aliphatic Urethane)', '3 gallon', 298.00, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 467 (HS Urethane Low Odor)', '1.25 gallon', 216.14, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 467 (HS Urethane Low Odor)', '5 gallon', 778.74, '500 Sqft/gal', 'Key Resins Direct'),
    (NULL, 'Key Resins 471 (polyaspartic)', '3 gallon', 329.94, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 471 (polyaspartic)', '15 gallon', 1748.55, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 502 (100 solids epoxy)', '3 gallon', 190.38, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 502 (100 solids epoxy)', '15 gallon', 906.15, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 510 CV (cove material)', '5 gallon', 312.75, '1.7 lbs/LF 6" cove', 'Key Resins Direct'),
    (NULL, 'Key Resins 511 (100 solids epoxy)', '3 gallon', 178.99, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 511 (100 solids epoxy)', '15 gallon', 823.44, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 515', '5 gallon', 290.66, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 520 (100 solids epoxy) Pigmented', '3 gallon', 194.69, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 520 (100 solids epoxy) Pigmented', '15 gallon', 922.71, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 532 W/B epoxy', '3 gallon', 212.01, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 60/100 NSA (aluminum oxide)', '1 gallon', 60.06, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 615 (Chemical resistant epoxy)', '15 gallon', 965.40, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 615 Chemical resistant Epoxy', '3 gallon', 210.02, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 630 (pigmented novolac)', '3 gallon', 353.70, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 630 (pigmented novolac)', '15 gallon', 1701.60, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 633 (Novolac) Pigmented', '3 Gallon', 378.14, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 633 (Novolac) Pigmented', '15 gallon', 1836.80, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 635 (MVB Moisture block)', '3.4 gallon', 416.50, '', 'Key Resins Direct'),
    (NULL, 'Key Resins 803 W/B Acrylic sealer', '5 Gallon', 110.98, '', 'Key Resins Direct'),
    (NULL, 'Key Resins BMA-50 (trowel cove sand)', '50 lbs', 19.99, '', 'Key Resins Direct'),
    (NULL, 'Key Resins Cove Powder', '50lbs', 77.67, '', 'Key Resins Direct'),
    (NULL, 'Key Resins Epocoat', '1.25 gallons', 68.75, '', 'Key Resins Direct'),
    (NULL, 'Key Resins Epoglaze', '1.5 gallon', 135.00, '', 'Key Resins Direct'),
    (NULL, 'Key Resins Pigment pack', '1qt', 33.18, '', 'Key Resins Direct'),
    (NULL, 'Key TS100 (Matting Agent)', '1 gallon', 13.00, '', 'Key Resins Direct'),
    (NULL, 'Key Urecon SLT (3/16 urethane)', '1 kit', 92.20, '', 'Key Resins Direct'),
    (NULL, 'Masterkure 300WB (Lapidolith)', '55 gallons', 945.00, '35 gal/16000 Sqft', 'CSS'),
    (NULL, 'MasterKure CC1315WB', '5 gallon', 205.00, '200 Sqft/gal', 'CSS +Freight'),
    (NULL, 'MasterSeal 658 (Tennis court)', '5 gallon', 210.00, '90-125 Sqft/gal', 'CSS +Freight'),
    (NULL, 'MasterSeal 658 Primer (Tennis court)', '5 gallon', 355.00, '200-300 Sqft/gal', 'CSS +Freight'),
    (NULL, 'MM80 Epoxy joint filler', '10 gallon', 506.00, '', 'Runyon'),
    (NULL, 'Neogard 70410', '5 gallon', 220.00, '', 'CSS'),
    (NULL, 'Neogard 70700/01', '3 gallon', 227.00, '', 'CSS'),
    (NULL, 'Neogard 70700/01', '15 gallon', 1005.00, '', 'CSS'),
    (NULL, 'Neogard 70704/05 Novolac Gray', '5 gallon', 641.25, '', 'CSS'),
    (NULL, 'Neogard 70714/15 (100 solids epoxy)', '3 gallon', 207.50, '', 'CSS'),
    (NULL, 'Neogard 70714/15 (100 solids epoxy)', '15 gallon', 963.50, '', 'CSS'),
    (NULL, 'Neogard 70734/35', '3 gallon', 232.80, '', 'CSS'),
    (NULL, 'Neogard 70817/70818 CRU', '2 gallon', 241.00, '', 'CSS'),
    (NULL, 'Neogard 7430', '5 gallon', 295.00, '', 'CSS'),
    (NULL, 'Neogard 7797/98', '3 gallon', 148.50, '', 'CSS'),
    (NULL, 'Neogard 7992 (16/30 sand)', '100lbs', 20.00, '', 'CSS'),
    (NULL, 'Neogard FC 7500/FC7960', '5 gallon', 260.00, '', 'CSS'),
    (NULL, 'Neogard FC 7540/FC7964', '3 gallon', 189.00, '', 'CSS'),
    (NULL, 'Neogard FC 7540/FC7964', '6 gallon', 359.00, '', 'CSS'),
    (NULL, 'Neogard FC 7545/FC7964', '6 gallon', 405.00, '', 'CSS'),
    (NULL, 'Neogard FC7548', '3 gallon', 215.00, '', 'CSS'),
    (NULL, 'New Look Quicketch', '1 gallon', 86.66, '100 Sqft/gal', 'CSS'),
    (NULL, 'New Look Quicketch', '5 gallon', 289.00, '', 'CSS'),
    (NULL, 'New Look Smart seal AU25', '1 gallon', 76.00, '200 Sqft/gal', 'CSS'),
    (NULL, 'New Look Smart seal AU25', '5 gallon', 252.00, '', 'CSS'),
    (NULL, 'Newlook Original Solid Stain', '4 oz', 48.00, '35-45 Sqft/kit', 'CSS'),
    (NULL, 'Newlook Original Solid Stain', '32 oz', 169.00, '350-400 Sqft/kit', 'CSS'),
    (NULL, 'Prosoco Siloxane PD', '5 gallon', 179.00, '', 'CSS'),
    (NULL, 'Prosoco LS guard', '5 gallon', 351.33, '', 'Runyon'),
    (NULL, 'Rapid Refloor', 'Cartridge', 51.81, '', 'CSS'),
    (NULL, 'Retro Guard', '5 gallon', 325.00, '', 'RetroPlate Direct'),
    (NULL, 'Retro Plate 99', '5 gallon', 125.00, '', 'RetroPlate Direct'),
    (NULL, 'Retro Plate Retro Pel', '5 gallons', 345.00, '600-1200 Sqft/gal', 'Retro plate'),
    (NULL, 'RetroPlate', '55 gallon', 1375.00, '200 Sqft/gal', 'RetroPlate Direct'),
    (NULL, 'Rubber Crumb', '50 lbs', 105.00, '300 Sqft/bag', 'CSS'),
    (NULL, 'Scofield Formula One Guard', '5 gallon', 457.62, '', 'Runyon'),
    (NULL, 'Scofield Formula One Finish coat', '1 gallon', 121.00, '', 'Runyon'),
    (NULL, 'Scofield Formula One Lithium Densifier', '5 gallon', 441.48, '', 'Runyon'),
    (NULL, 'Seam tape (plywood deck joint tape)', '100''', 19.75, '', 'CSS'),
    (NULL, 'Sherwin Williams Armorseal 8100', '1.25 gallon', 122.50, '', 'Sherwin Williams'),
    (NULL, 'Sherwin Williams Armorseal 8100', '5 gallon', 475.00, '', 'Sherwin Williams'),
    (NULL, 'Sika 1000', '50 lbs', 29.25, '', 'CSS'),
    (NULL, 'Sika 1A', '20 oz', 7.95, '', 'CSS'),
    (NULL, 'Sika 2500', '50 lbs', 30.95, '', 'CSS'),
    (NULL, 'Sika 2c ns', '1.5 gallon', 65.00, '', 'CSS'),
    (NULL, 'Sika Armatec 110 epocem', '1.65 gallon', 263.80, '', ''),
    (NULL, 'Sika color pack', '1 bag', 10.45, '', 'CSS'),
    (NULL, 'Sika Pro 100-350', '5 gallon', 275.00, '', 'Whitecap'),
    (NULL, 'Sika Skim Coat', '10lbs', 19.79, '', 'CSS'),
    (NULL, 'Sika VOH', '44lbs', 32.40, '', 'CSS'),
    (NULL, 'SIkacolor Elements', '4 pack', 364.00, '', 'Whitecap'),
    (NULL, 'TK 290 (Tri siloxane)', '5 gallon', 195.00, '200 Sqft/gal', 'CSS'),
    (NULL, 'TK Bright Kure', '5 gallon', 187.65, '', 'CSS'),
    (NULL, 'TK Bright Kure', '55 gallon', 2150.00, '', 'CSS'),
    (NULL, 'Tremco Dymeric 240FC (warehouse caulk)', '1.5 gallon', 75.00, '', 'CSS'),
    (NULL, 'TRU PC NATURAL', '60 lbs', 45.00, '', 'Runyon'),
    (NULL, 'Tufflex 6000AL', '5 gallon', 365.40, '80-100 Sqft/gal', 'CSS'),
    (NULL, 'Tufflex Primer #2', '2 gallon', 162.20, '300-350 Sqft/gal', 'CSS'),
    (NULL, 'Tufflex primer #3', '1.5 gallon', 143.85, '300-400 Sqft/gal', 'CSS'),
    (NULL, 'Tufflex RBC', '5 gallon', 281.00, '250 Sqft/kit @30 mils', 'CSS'),
    (NULL, 'TX3', '2 gallon', 150.00, '', 'High Tec'),
    (NULL, 'TX3 Cartridge', 'Cartridge', 45.00, '', 'Hi-Tec'),
    (NULL, 'Vocomp 25 (water base acrylic sealer)', '5 gallon', 180.00, '', 'Online'),
    (NULL, 'Vocomp30', '5 gallon', 245.00, '400 Sqft/gal', 'CSS'),
    (NULL, 'XYPEX', '60lbs', 210.00, '', 'CSS');
  END IF;
END $seed$;
