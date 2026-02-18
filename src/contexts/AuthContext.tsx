// ========================================
// Auth Context - Autenticação e Roles
// ========================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
    onAuthChange,
    getUser,
    signIn,
    signUp,
    createDocumentWithId,
    signOut as firebaseSignOut,
    COLLECTIONS,
} from '../services/firebase';
import type { User } from '../types';

interface AuthContextType {
    user: User | null;
    firebaseUser: FirebaseUser | null;
    loading: boolean;
    error: string | null;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, name: string) => Promise<void>;
    signOut: () => Promise<void>;
    isOwner: boolean;
    isSeller: boolean;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Check for persisted mock user on mount
    // Check for persisted mock user on mount
    useEffect(() => {
        // Try Firebase auth
        const unsubscribe = onAuthChange(async (fbUser) => {
            setFirebaseUser(fbUser);
            if (fbUser) {
                try {
                    const userData = await getUser(fbUser.uid);
                    setUser(userData);
                } catch (err) {
                    console.error('Error fetching user data:', err);
                }
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleSignIn = async (email: string, password: string) => {
        setError(null);
        setLoading(true);

        try {
            console.log('Tentando login com:', email);
            await signIn(email, password);
            console.log('Login bem sucedido!');
        } catch (err: any) {
            console.error('Erro no login:', err.code, err.message, err);
            let errorMessage = 'Erro ao fazer login';
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
                errorMessage = 'Email ou senha incorretos';
            } else if (err.code === 'auth/too-many-requests') {
                errorMessage = 'Muitas tentativas. Aguarde um momento.';
            } else if (err.code === 'auth/wrong-password') {
                errorMessage = 'Senha incorreta';
            }
            setError(errorMessage);
            setLoading(false);
            throw err;
        }
    };

    const handleSignUp = async (email: string, password: string, name: string) => {
        setError(null);
        setLoading(true);

        try {
            const userCredential = await signUp(email, password);

            // Create user profile in Firestore as owner
            await createDocumentWithId(COLLECTIONS.users, userCredential.user.uid, {
                email: email,
                name: name,
                role: 'owner', // Novos usuários são proprietários
            });

            // onAuthChange will handle state update
        } catch (err: any) {
            console.error('Firebase SignUp Error:', err.code, err.message, err);
            let errorMessage = 'Erro ao criar conta';
            if (err.code === 'auth/email-already-in-use') {
                errorMessage = 'Este email já está cadastrado';
            } else if (err.code === 'auth/weak-password') {
                errorMessage = 'A senha deve ter pelo menos 6 caracteres';
            } else if (err.code === 'auth/invalid-email') {
                errorMessage = 'Email inválido';
            } else if (err.code === 'auth/operation-not-allowed') {
                errorMessage = 'Provedor de email/senha não está ativado no Firebase';
            } else if (err.code === 'auth/configuration-not-found') {
                errorMessage = 'Configuração do Firebase inválida';
            }
            setError(errorMessage);
            setLoading(false);
            throw err;
        }
    };

    const handleSignOut = async () => {
        try {
            await firebaseSignOut();
            setUser(null);
            setFirebaseUser(null);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Erro ao sair';
            setError(errorMessage);
            throw err;
        }
    };

    const value: AuthContextType = {
        user,
        firebaseUser,
        loading,
        error,
        signIn: handleSignIn,
        signUp: handleSignUp,
        signOut: handleSignOut,
        isOwner: user?.role === 'owner',
        isSeller: user?.role === 'seller',
        isAdmin: user?.role === 'admin',
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default AuthContext;
