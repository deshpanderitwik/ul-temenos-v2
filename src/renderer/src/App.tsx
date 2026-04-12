import { useEffect } from 'react'
import { migrateFromSupabaseIfNeeded } from './lib/migrateFromSupabase'
import WritingWorkspace from './components/WritingWorkspace'

export default function App() {
  useEffect(() => {
    migrateFromSupabaseIfNeeded()
  }, [])

  return (
    <div className="h-screen w-screen bg-[#141414] overflow-hidden">
      <WritingWorkspace />
    </div>
  )
}
