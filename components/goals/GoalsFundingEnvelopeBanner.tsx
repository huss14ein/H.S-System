import React from 'react';

type Props = {
  goalNames: string[];
};

/** When goals have both budget and investment links, envelope uses budget only (not summed). */
const GoalsFundingEnvelopeBanner: React.FC<Props> = ({ goalNames }) => {
  if (goalNames.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-950" role="status">
      <p className="font-semibold">Projected monthly uses linked budget only</p>
      <p className="mt-1 text-indigo-900/90 leading-relaxed">
        {goalNames.length === 1 ? (
          <>
            <strong>{goalNames[0]}</strong> has both a budget and an investment plan/deposit link. The envelope is{' '}
            <strong>not</strong> budget + plan — only the budget monthly amount counts toward projected funding.
          </>
        ) : (
          <>
            {goalNames.slice(0, 3).join(', ')}
            {goalNames.length > 3 ? ` (+${goalNames.length - 3} more)` : ''} have budget + investment links. Envelope =
            budget only (investment link is informational).
          </>
        )}
      </p>
    </div>
  );
};

export default React.memo(GoalsFundingEnvelopeBanner);
