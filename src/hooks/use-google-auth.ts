import { useState, useEffect, useCallback } from 'react';

export function useGoogleAuth() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const checkAuth = useCallback(async () => {
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            setIsAuthenticated(data.isAuthenticated);
        } catch (e) {
            setIsAuthenticated(false);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        checkAuth();

        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
                checkAuth();
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [checkAuth]);

    const login = async () => {
        try {
            const res = await fetch('/api/auth/url');
            const { url } = await res.json();
            window.open(url, 'oauth_popup', 'width=600,height=700');
        } catch (e) {
            console.error("Failed to get auth URL", e);
        }
    };

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        setIsAuthenticated(false);
    };

    return { isAuthenticated, isLoading, login, logout, checkAuth };
}
