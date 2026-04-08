import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import WritingWorkspace from './components/WritingWorkspace'

export default function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    async function signIn() {
      const { data: { session } } = await supabase.auth.getSession()

      if (session) {
        setReady(true)
        return
      }

      const email = import.meta.env.VITE_SUPABASE_USER_EMAIL
      const password = import.meta.env.VITE_SUPABASE_USER_PASSWORD

      const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        console.error('Auth failed:', error.message)
      } else {
        setReady(true)
      }
    }

    signIn()
  }, [])

  if (!ready) return null

  return (
    <div className="h-screen w-screen bg-[#141414] overflow-hidden">
      <WritingWorkspace />
    </div>
  )
}
