import React, { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { HSLogo } from '../components/icons/HSLogo';
import { getBuildSha, getCanonicalAppUrl, isOnCanonicalHost } from '../utils/buildInfo';

const PendingApprovalPage: React.FC = () => {
  const auth = useContext(AuthContext);
  const rejected = auth?.isSignupRejected === true;
  const syncIssue = auth?.approvalSyncIssue;
  const [checking, setChecking] = useState(false);
  const [profileHint, setProfileHint] = useState<string | null>(null);
  const onCanonicalHost = isOnCanonicalHost();
  const canonicalUrl = getCanonicalAppUrl();
  const buildSha = getBuildSha();

  const handleRecheck = async () => {
    setChecking(true);
    try {
      await auth?.refetchApprovalStatus();
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (rejected) {
      setProfileHint(null);
      return;
    }
    if (syncIssue === 'rpc_missing') {
      setProfileHint(
        'Database setup is incomplete: run migrations 20260531180000 and 20260531200000 in Supabase SQL Editor, then tap Check status.',
      );
      return;
    }
    if (syncIssue === 'network') {
      setProfileHint('Could not reach the server. Check mobile data or Wi‑Fi, then tap Check status.');
      return;
    }
    setProfileHint('An administrator must approve your signup before you can use Finova.');
  }, [rejected, syncIssue]);

  useEffect(() => {
    if (rejected || !auth?.user?.id) return;
    const id = window.setInterval(() => {
      void auth.refetchApprovalStatus();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [auth, rejected]);

  const title = rejected
    ? 'Signup not approved'
    : syncIssue === 'rpc_missing'
      ? 'Setup required'
      : syncIssue === 'network'
        ? 'Connection issue'
        : 'Account pending approval';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg border border-slate-200/80">
        <div className="flex justify-center mb-6">
          <HSLogo className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">{title}</h2>
        <p className="text-slate-600 mb-4 text-center text-sm leading-relaxed">
          {rejected ? (
            <>
              An administrator declined this signup. Sign out and use a different account, or contact support if this
              was a mistake.
            </>
          ) : syncIssue === 'rpc_missing' ? (
            <>The approval service is not available until Supabase migrations are applied for this project.</>
          ) : syncIssue === 'network' ? (
            <>We could not load your account profile. This is usually temporary on mobile networks.</>
          ) : (
            <>
              You are signed in, but full access is not enabled yet. Once an administrator approves your account, you
              can use the dashboard and your private data.
            </>
          )}
        </p>
        {auth?.user?.email && (
          <p className="text-xs text-slate-500 text-center mb-2">
            Signed in as <span className="font-medium text-slate-700">{auth.user.email}</span>
          </p>
        )}
        <p className="text-[10px] text-slate-400 text-center mb-4 font-mono">Build {buildSha}</p>
        {!onCanonicalHost && (
          <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4" role="status">
            Use the latest app at{' '}
            <a href={canonicalUrl} className="font-semibold underline">
              {canonicalUrl.replace(/^https:\/\//, '')}
            </a>
            {' '}and remove any old home-screen shortcut.
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
          {!onCanonicalHost && (
            <a
              href={canonicalUrl}
              className="w-full flex justify-center py-2.5 px-4 border border-primary rounded-lg text-sm font-semibold text-primary bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
            >
              Open latest app
            </a>
          )}
          <button
            type="button"
            onClick={() => void auth?.logout()}
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
