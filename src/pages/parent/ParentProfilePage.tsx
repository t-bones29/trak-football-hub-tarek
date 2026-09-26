import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Settings as SettingsIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { ParentChildSelector, ParentFamilyContent } from '@/components/parent/ParentFamily'
import { ParentConsentWithdrawal } from '@/components/parent/ParentConsentWithdrawal'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { IconHowItWorks } from '@/components/icons/TrakIcons'

export default function ParentProfilePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { children, selectedChild } = useParentChildren()

  return (
    <MobileShell>
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-white/[0.07]">
        <span className="text-[16px] font-medium text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>Profile</span>
      </div>

      <div className="pt-3.5 pb-4 space-y-2.5">
        {/* Avatar + Identity */}
        <div className="text-center mb-6">
          <div className="w-[72px] h-[72px] rounded-[22px] overflow-hidden bg-[#202024] border border-[rgba(200,242,90,0.18)] mx-auto mb-3 flex items-center justify-center">
            <span className="text-2xl font-semibold text-primary" aria-hidden="true">
              {(profile?.full_name || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="text-[20px] font-semibold text-white/88 tracking-tight" style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>
            {profile?.full_name || 'Parent'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">Parent account</p>
        </div>

        <ParentChildSelector />
        <ParentFamilyContent>
          <p className="text-sm text-muted-foreground pb-3">
            Following {selectedChild?.name} · {children.length} {children.length === 1 ? 'child' : 'children'} linked
          </p>
          <ParentConsentWithdrawal />
        </ParentFamilyContent>

        {/* Account info */}
        <Section label="ACCOUNT">
          <Row label="Name" value={profile?.full_name || '—'} />
          <Row label="Email" value={user?.email || '—'} last />
        </Section>

        {/* How TRAK works link */}
        <button
          onClick={() => navigate('/how-it-works')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(200,242,90,0.08)', border: '1px solid rgba(200,242,90,0.18)' }}>
              <IconHowItWorks size={16} color="#C8F25A" />
            </div>
            <div>
              <MetadataLabel text="HOW TRAK WORKS" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Performance bands & rating engine
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>

        {/* Settings entry */}
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center justify-between rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] text-left hover:bg-[#141416] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.04] flex items-center justify-center">
              <SettingsIcon size={16} className="text-white/55" />
            </div>
            <div>
              <MetadataLabel text="SETTINGS" />
              <p className="text-[12px] text-white/55 mt-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Account settings
              </p>
            </div>
          </div>
          <ChevronRight size={18} className="text-white/40" />
        </button>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-1 mb-2">
        <MetadataLabel text={label} />
      </div>
      <div className="px-4 rounded-[18px] border border-white/[0.07] bg-[#101012]">
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className="py-3.5 flex items-center justify-between gap-3"
      style={{ borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.45)',
        }}
      >
        {label}
      </span>
      <span className="text-[13px] text-white/78 truncate max-w-[200px]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {value}
      </span>
    </div>
  )
}
