import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { HSLogo } from '../components/icons/HSLogo';
import { supabase } from '../services/supabaseClient';
import { getCanonicalAppUrl, isOnCanonicalHost } from '../utils/buildInfo';

const PendingApprovalPage: React.FC = () => {
  const auth = useContext(AuthContext);
  const rejected = auth?.isSignupRejected === true;
  const [checking, setChecking] = useState(false);
  const [profileHint, setProfileHint] = useState<string | null>(null);
  const onCanonicalHost = isOnCanonicalHost();
  const canonicalUrl = getCanonicalAppUrl();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase || !auth?.user?.id) return;
      const { data } = await supabase.from('users').select('role, approved, email').eq('id', auth.user.id).maybeSingle();
      if (!alive || !data) return;
      const role = String((data as { role?: string }).role ?? '').trim();
      const approved = Boolean((data as { approved?: boolean }).approved);
      if (role.toLowerCase() === 'admin' && !approved) {
        setProfileHint('Your account is Admin but not marked approved yet. Tap Check status below or ask another admin to approve you in Settings.');
      } else if (!approved) {
        setProfileHint('An administrator must approve your signup before you can use Finova.');
      }
    })();
    return () => { alive = false; };
  }, [auth?.user?.id]);

  // Poll while on this screen — helps mobile after admin approval without a full reload.
  useEffect(() => {
    if (rejected || !auth?.user?.id) return;
    const id = window.setInterval(() => {
      void auth?.refetchApprovalStatus();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [auth, rejected]);

  const handleLogout = async () => {
    await auth?.logout();
    window.location.hash = '';
  };

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await auth?.refetchApprovalStatus();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg border border-slate-200/80">
        <div className="flex justify-center mb-6">
          <HSLogo className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">
          {rejected ? 'Signup not approved' : 'Account pending approval'}
        </h2>
        <p className="text-slate-600 mb-4 text-center text-sm leading-relaxed">
          {rejected ? (
            <>
              An administrator declined this signup. Sign out and use a different account, or contact support if this
              was a mistake.
            </>
          ) : (
            <>
              You are signed in, but full access is not enabled yet. Once an administrator approves your account, you
              can use the dashboard and your private data.
            </>
          )}
        </p>
        {auth?.user?.email && (
          <p className="text-xs text-slate-500 text-center mb-4">
            Signed in as <span className="font-medium text-slate-700">{auth.user.email}</span>
          </p>
        )}
        {!onCanonicalHost && (
          <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4" role="status">
            This device may be using an older app link ({typeof window !== 'undefined' ? window.location.hostname : 'preview'}).
            Open the latest app at{' '}
            <a href={canonicalUrl} className="font-semibold underline">
              {canonicalUrl.replace(/^https:\/\//, '')}
            </a>
            {' '}and sign in again. If you added Finova to your home screen, remove it and re-add from that URL.
          </div>
        )}
        {profileHint && !rejected && (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4" role="status">
            {profileHint}
          </p>
        )}
        <div className="space-y-3">
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleRecheck()}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-60"
          >
            {checking ? 'Checking…' : 'Check approval status'}
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full flex justify-center py-2.5 px-4 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default PendingApprovalPage;
