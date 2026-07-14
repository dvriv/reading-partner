import { useEffect, useState } from 'react';
import { Link, router } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { BodyText, Button, Card } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';
import { supabase } from '../src/lib/supabase';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => setSession(data.session));
    const subscription = supabase?.auth.onAuthStateChange((_event, next) => setSession(next)).data.subscription;
    return () => subscription?.unsubscribe();
  }, []);
  return (
    <Screen title="SpoilerFree">
      <Card>
        <BodyText>Upload DRM-free EPUBs, mark your exact reading progress, and ask questions without leaking future chapters to the AI pipeline.</BodyText>
        {session ? <Button onPress={() => router.push('/library')}>Open Library</Button> : <Link href="/sign-in" asChild><Button>Sign In</Button></Link>}
      </Card>
    </Screen>
  );
}
