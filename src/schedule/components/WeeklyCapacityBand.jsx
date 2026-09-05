import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { loadJobs, computeHomeDashboard, wkDates, getMonday, fmtD } from '../lib/queries'
import HomeCapacityStrip from './HomeCapacityStrip'

// Self-contained Weekly Crew Capacity band. Loads its own week-scoped data and
// renders the same HomeCapacityStrip the Home/Jobs dashboards use — so the header
// can be mounted once (in ScheduleLayout) across the functional screens (Crew
// Schedule / Calendar / Daily / Logistics) without wiring data into each view.
// Assignments are date-scoped to this week, so this never hits the 1000-row cap.
export default function WeeklyCapacityBand() {
  const [jobs, setJobs] = useState([])
  const [crew, setCrew] = useState([])
  const [weekAssignments, setWeekAssignments] = useState([])
  const [crewStatusMap, setCrewStatusMap] = useState({})

  const monday = useMemo(() => getMonday(new Date()), [])
  const dates = useMemo(() => wkDates(monday), [monday])
  const todayStr = fmtD(new Date())
  const wsStr = dates[0]
  const weStr = dates[dates.length - 1]

  const load = useCallback(async () => {
    const [jobsRes, crewRes, asgnRes, csRes] = await Promise.all([
      loadJobs({ withWTCs: false }),
      supabase.from('crew').select('*'),
      supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
      supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
    ])
    setJobs(jobsRes.data || [])
    setCrew((crewRes.data || []).filter(c => !c.archived))
    setWeekAssignments(asgnRes.data || [])
    const csMap = {}
    for (const c of (csRes.data || [])) csMap[c.crew_name + '|' + c.date] = c.status
    setCrewStatusMap(csMap)
  }, [wsStr, weStr])

  useEffect(() => { load() }, [load])

  const dash = useMemo(() => computeHomeDashboard({
    jobs, crew, crewStatusMap, weekAssignments, allAssignments: weekAssignments,
    dates, todayStr,
  }), [jobs, crew, crewStatusMap, weekAssignments, dates, todayStr])

  const weekLabel = useMemo(() => {
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const a = new Date(dates[0] + 'T00:00:00'), b = new Date(dates[dates.length - 1] + 'T00:00:00')
    return `${M[a.getMonth()]} ${a.getDate()} – ${M[b.getMonth()]} ${b.getDate()}`
  }, [dates])

  if (!crew.length) return null
  return <HomeCapacityStrip data={dash} weekLabel={weekLabel} />
}
