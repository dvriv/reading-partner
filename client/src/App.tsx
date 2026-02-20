import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AuthForm from './components/AuthForm';
import Library from './pages/Library';
import SeriesChat from './pages/SeriesChat';
import BookChat from './pages/BookChat';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    return <AuthForm onAuth={setSession} />;
  }

  if (selectedSeriesId) {
    return (
      <SeriesChat
        seriesId={selectedSeriesId}
        authToken={session.access_token}
        onBack={() => setSelectedSeriesId(null)}
      />
    );
  }

  if (selectedBookId) {
    return (
      <BookChat
        bookId={selectedBookId}
        authToken={session.access_token}
        onBack={() => setSelectedBookId(null)}
      />
    );
  }

  return (
    <Library
      onSelectSeries={setSelectedSeriesId}
      onSelectBook={setSelectedBookId}
      onLogout={async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
      }}
      authToken={session.access_token}
    />
  );
}

export default App;
