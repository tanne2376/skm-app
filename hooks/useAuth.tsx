import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { Profile, UserRole } from '@/types';

const PASSWORD_RECOVERY_KEY = 'skm_password_recovery';

interface AuthContextType {
  session: Session | null;
  profile: Profile | null;
  role: UserRole | null;
  isLoading: boolean;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const setRecoveryFlag = useCallback(async (value: boolean) => {
    setIsPasswordRecovery(value);
    if (value) {
      await SecureStore.setItemAsync(PASSWORD_RECOVERY_KEY, '1');
    } else {
      await SecureStore.deleteItemAsync(PASSWORD_RECOVERY_KEY);
    }
  }, []);

  const clearPasswordRecovery = useCallback(() => setRecoveryFlag(false), [setRecoveryFlag]);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data ?? null);
  }, []);

  useEffect(() => {
    async function init() {
      // Restore password recovery flag from persistent storage
      const recoveryFlag = await SecureStore.getItemAsync(PASSWORD_RECOVERY_KEY);
      if (recoveryFlag === '1') {
        setIsPasswordRecovery(true);
      }

      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (session?.user) {
        await fetchProfile(session.user.id);
      }
      setIsLoading(false);
    }
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryFlag(true);
      } else if (event === 'SIGNED_IN') {
        // Clear recovery flag on normal sign-in (not recovery)
        setRecoveryFlag(false);
      }
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, setRecoveryFlag]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, fullName: string, phone?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone: phone ?? '' },
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        role: profile?.role ?? null,
        isLoading,
        isPasswordRecovery,
        clearPasswordRecovery,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
