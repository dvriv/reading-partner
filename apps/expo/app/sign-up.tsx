import { useState } from 'react';
import { router } from 'expo-router';
import { BodyText, Button, Card, Input } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';
import { supabase } from '../src/lib/supabase';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(
    supabase ? '' : 'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/expo/.env, then restart Expo.',
  );
  return (
    <Screen title="Sign Up">
      <Card>
        <Input autoCapitalize="none" placeholder="Email" value={email} onChangeText={setEmail} />
        <Input secureTextEntry placeholder="Password" value={password} onChangeText={setPassword} />
        <Button onPress={async () => {
          if (!supabase) return;
          const { error } = await supabase.auth.signUp({ email, password });
          if (error) setMessage(error.message); else router.replace('/library');
        }}>Create Account</Button>
        {message ? <BodyText>{message}</BodyText> : null}
      </Card>
    </Screen>
  );
}
