import type { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Role } from '@/domain';
import { supabase } from './supabase';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
}

interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('id, email, full_name, role, active').eq('id', s.user.id).maybeSingle();
    if (error) {
      setProfileError(error.message);
      setProfile(null);
    } else if (!data) {
      setProfileError('Tài khoản chưa có hồ sơ trong app. Nhờ Admin kiểm tra.');
      setProfile(null);
    } else {
      setProfileError(null);
      setProfile(data as Profile);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Defer the query out of the auth callback (supabase-js advice).
      setTimeout(() => loadProfile(s), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value: SessionState = {
    loading,
    session,
    profile,
    profileError,
    refreshProfile: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export function useProfile(): Profile {
  const { profile } = useSession();
  if (!profile) throw new Error('No profile');
  return profile;
}
