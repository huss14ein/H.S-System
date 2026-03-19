import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { HSLogo } from '../components/icons/HSLogo';
import { supabase } from '../services/supabaseClient';

const SignupPage: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const auth = useContext(AuthContext);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setSuccess(false);
    const result = await auth!.signup(name.trim(), email.trim(), password);
    if (result.error) {
      setError(result.error.message);
    } else if (result.user) {
      setSuccess(true);
    }
    setLoading(false);
  };

  const goToLogin = () => {
    window.location.hash = '';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md">
        <div className="flex justify-center mb-6">
          <HSLogo className="h-12 w-12 text-primary" />
        </div>
        {!supabase ? (
          <div className="text-center">
            <h2 className="text-2xl font-bold text-red-600 mb-2">Configuration Error</h2>
            <p className="text-gray-600">The application cannot connect to the backend service.</p>
          </div>
        ) : (
          <>
            <h2 className="text-center text-3xl font-bold text-dark mb-2">Create account</h2>
            <p className="text-center text-gray-500 mb-6">Sign up for your Finova account.</p>
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && <p className="text-red-500 text-sm text-center bg-red-50 p-3 rounded-md">{error}</p>}
              {success && (
                <p className="text-emerald-700 text-sm text-center bg-emerald-50 p-3 rounded-md border border-emerald-200">
                  Account created. Your access is pending admin approval. You can sign in to check your status.
                </p>
              )}
              <div>
                <label htmlFor="signup-name" className="block text-sm font-medium text-gray-700">Full name</label>
                <input
                  type="text"
                  id="signup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="signup-email" className="block text-sm font-medium text-gray-700">Email address</label>
                <input
                  type="email"
                  id="signup-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="signup-password" className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  type="password"
                  id="signup-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={12}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">At least 12 characters with uppercase, lowercase, number and symbol.</p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400"
              >
                {loading ? 'Creating account...' : 'Sign up'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-gray-500">
              Already have an account?{' '}
              <button type="button" onClick={goToLogin} className="font-medium text-primary hover:underline focus:outline-none">
                Log in
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default SignupPage;
