import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef
} from 'react'
import { createPortal } from 'react-dom'
import { XMarkIcon } from '@heroicons/react/24/outline'

function focusableSelector(): string {
  return [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ')
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector())).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
  )
}

export type AppModalProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  /** Shown in the header. If omitted, pass aria-label for the dialog. */
  title?: string
  'aria-label'?: string
}

export default function AppModal({
  open,
  onClose,
  children,
  title,
  'aria-label': ariaLabel
}: AppModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)

  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab' || !panelRef.current) return

      const nodes = getFocusableElements(panelRef.current)
      if (nodes.length === 0) return

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    },
    []
  )

  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      lastFocusRef.current = document.activeElement as HTMLElement | null
      window.requestAnimationFrame(() => {
        closeButtonRef.current?.focus()
      })
    } else if (lastFocusRef.current) {
      lastFocusRef.current.focus()
      lastFocusRef.current = null
    }
  }, [open])

  if (!open) return null

  const labelledBy = title ? titleId : undefined
  const dialogLabel = !title ? ariaLabel : undefined

  if (import.meta.env.DEV && !title && !dialogLabel) {
    console.warn('AppModal: provide title or aria-label for accessibility.')
  }

  return createPortal(
    <>
      <div
        role="presentation"
        className="fixed top-0 left-0 w-full h-full z-[200] cursor-default transition-opacity duration-300"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      />
      <div
        className="fixed z-[210] top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none box-border"
        style={{ padding: 'var(--app-modal-viewport-gutter)' }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-label={dialogLabel}
          tabIndex={-1}
          onKeyDown={handleDialogKeyDown}
          className="bg-[#141414] border border-white/10 rounded-xl w-full max-w-2xl h-[672px] shadow-xl flex flex-col min-h-0 transition-transform duration-300 scale-100 pointer-events-auto outline-none contain-layout box-border"
          style={{
            fontFamily: 'var(--font-ui)',
            maxHeight:
              'min(672px, calc(100vh - (var(--app-modal-viewport-gutter) * 2)))'
          }}
        >
          <div
            className="flex flex-col flex-1 min-h-0 min-w-0 box-border"
            style={{ padding: 'var(--app-modal-content-inset)' }}
          >
            <header className="flex shrink-0 items-start justify-between gap-4">
              {title ? (
                <h2
                  id={titleId}
                  className="min-w-0 flex-1 text-left text-2xl font-semibold tracking-tight text-white leading-tight"
                >
                  {title}
                </h2>
              ) : (
                <span className="flex-1" />
              )}
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="shrink-0 text-gray-400 p-2 transition-all rounded hover:text-white hover:bg-white/10"
                aria-label="Close"
              >
                <XMarkIcon strokeWidth={1.5} className="w-5 h-5" aria-hidden />
              </button>
            </header>

            <div
              className="flex-1 min-h-0 min-w-0 overflow-y-auto"
              style={{ marginTop: 'var(--app-modal-title-to-body)' }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
