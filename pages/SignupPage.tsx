
import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { HSLogo } from '../components/icons/HSLogo';

interface SignupPageProps {
    onSwitchToLogin: () => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ onSwitchToLogin }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const auth = useContext(AuthContext);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        auth?.signup(name, email, password);
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center">
            <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md">
                <div className="flex justify-center mb-6">
                    <HSLogo className="h-12 w-12 text-primary" />
                </div>
                <h2 className="text-center text-3xl font-bold text-dark mb-2">Create Account</h2>
                <p className="text-center text-gray-500 mb-6">Start managing your finances with H.S.</p>
                <form onSubmit={handleSubmit} className="space-y-6">
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
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                    >
                        Sign Up
                    </button>
                </form>
                <p className="mt-6 text-center text-sm text-gray-600">
                    Already have an account?{' '}
                    <button onClick={onSwitchToLogin} className="font-medium text-primary hover:text-secondary">
                        Log in
                    </button>
                </p>
            </div>
        </div>
    );
};

export default SignupPage;
