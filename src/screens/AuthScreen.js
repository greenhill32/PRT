import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { signUp, signIn } from '../supabase';
import '../styles/AuthScreen.css';
export default function AuthScreen() {
    const [mode, setMode] = useState('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            if (mode === 'signup') {
                await signUp(email, password);
                setError('Check your email for confirmation');
            }
            else {
                await signIn(email, password);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "auth-screen", children: _jsxs("div", { className: "auth-card", children: [_jsx("h1", { children: "PRT Virtual Gym" }), _jsx("p", { children: "Log your Saturday PRT results and race simulated competitors" }), _jsxs("form", { onSubmit: handleSubmit, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "email", children: "Email" }), _jsx("input", { id: "email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true, disabled: loading })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { htmlFor: "password", children: "Password" }), _jsx("input", { id: "password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), required: true, disabled: loading })] }), error && _jsx("div", { className: "error-message", children: error }), _jsx("button", { type: "submit", disabled: loading, className: "primary-button", children: loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Sign Up' })] }), _jsx("div", { className: "auth-toggle", children: mode === 'signin' ? (_jsxs(_Fragment, { children: ["Don't have an account?", ' ', _jsx("button", { type: "button", onClick: () => setMode('signup'), className: "link-button", children: "Sign up" })] })) : (_jsxs(_Fragment, { children: ["Already have an account?", ' ', _jsx("button", { type: "button", onClick: () => setMode('signin'), className: "link-button", children: "Sign in" })] })) })] }) }));
}
