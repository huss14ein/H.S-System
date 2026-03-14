import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { HSLogo } from '../components/icons/HSLogo';
import { supabase } from '../services/supabaseClient';

interface SignupPageProps {
    onSwitchToLogin: () => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ onSwitchToLogin }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [consent, setConsent] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const auth = useContext(AuthContext);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess(false);
        if (!consent) {
            setError('You must agree to the Terms of Service and Privacy Policy to create an account.');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }
        setLoading(true);
        const { error: err } = await auth!.signup(name, email, password);
        if (err) {
            setError(err.message);
        } else {
            setSuccess(true);
        }
        setLoading(false);
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
                        <p className="mt-4 text-sm bg-red-50 text-red-700 p-3 rounded-md">
                            Account creation is currently disabled. Please ensure the Supabase URL and Key are correctly configured.
                        </p>
                    </div>
                ) : (
                    <>
                        <h2 className="text-center text-3xl font-bold text-dark mb-2">Create Account</h2>
                        <p className="text-center text-gray-500 mb-6">Start managing your finances with Finova.</p>
                        {success ? (
                            <div className="text-center p-4 bg-green-50 text-green-800 rounded-md" role="status">
                                <h3 className="font-semibold">Success!</h3>
                                <p>Please check your email to confirm your account. You can then log in.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {error && <p className="text-red-500 text-sm text-center bg-red-50 p-3 rounded-md">{error}</p>}
                                <div>
                                    <label htmlFor="name" className="block text-sm font-medium text-gray-700">Full Name</label>
                                    <input
                                        type="text"
                                        id="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="email-signup" className="block text-sm font-medium text-gray-700">Email Address</label>
                                    <input
                                        type="email"
                                        id="email-signup"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="password-signup" className="block text-sm font-medium text-gray-700">Password</label>
                                    <input
                                        type="password"
                                        id="password-signup"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={8}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
                                </div>
                                <div className="flex items-start">
                                    <input
                                        type="checkbox"
                                        id="consent-signup"
                                        checked={consent}
                                        onChange={(e) => setConsent(e.target.checked)}
                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        aria-describedby="consent-desc"
                                    />
                                    <label id="consent-desc" htmlFor="consent-signup" className="ml-2 text-sm text-gray-700">
                                        I agree to the <a href="/terms" className="text-primary hover:underline">Terms of Service</a> and <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
                                    </label>
                                </div>
                                <p className="text-xs text-gray-500">We use your data only to run your financial dashboard and never sell it to third parties.</p>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400"
                                >
                                    {loading ? 'Creating Account...' : 'Sign Up'}
                                </button>
                            </form>
                        )}
                         <p className="mt-6 text-center text-sm text-gray-600">
                            Already have an account?{' '}
                            <button onClick={onSwitchToLogin} className="font-medium text-primary hover:text-secondary">
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