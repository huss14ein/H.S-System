import React, { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { HSLogo } from '../components/icons/HSLogo';

const PendingApprovalPage: React.FC = () => {
  const auth = useContext(AuthContext);
  const rejected = auth?.isSignupRejected === true;

  const handleLogout = async () => {
    await auth?.logout();
    window.location.hash = '';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md text-center">
        <div className="flex justify-center mb-6">
          <HSLogo className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">
          {rejected ? 'Signup Not Approved' : 'Account Pending Approval'}
        </h2>
        <p className="text-slate-600 mb-6">
          {rejected ? (
            <>
              An administrator has not approved access for this account. You will not be able to use the platform with
              this login. Contact your administrator if you believe this is a mistake, or sign out and use a different
              account.
            </>
          ) : (
            <>
              Your account has been created successfully. Access to the platform requires approval from an administrator.
              You will be able to sign in once your account has been approved.
            </>
          )}
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex justify-center py-2 px-4 border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => auth?.refetchApprovalStatus()}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            Check approval status
          </button>
        </div>
      </div>
    </div>
  );
};

export default PendingApprovalPage;
