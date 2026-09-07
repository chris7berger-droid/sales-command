import { createContext, useContext } from 'react'

// Carries ScheduleShell's toolbar actions (+ Job / Actions) down to whichever
// Weekly Crew Capacity band is on screen, so the buttons can live inside that
// band's header instead of a separate strip. One provider (the shell), one
// consumer per route (HomeCapacityStrip via the band or the Jobs view).
export const ToolbarContext = createContext(null)
export const useToolbarActions = () => useContext(ToolbarContext)
