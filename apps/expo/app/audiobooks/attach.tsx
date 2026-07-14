import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, router } from 'expo-router';
import { BodyText, Button, Card } from '../../src/components/Controls';
import { Screen } from '../../src/components/Screen';
import { apiFetch, logClient } from '../../src/lib/api';

export default function AttachAudiobook() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const [message, setMessage] = useState('');
  return (
    <Screen title="Attach Audiobook">
      <Card>
        <BodyText>Attach audiobook metadata. Original audio is not stored long-term; alignment uploads a temporary short-window file in this dev build.</BodyText>
        <Button onPress={async () => {
          const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true });
          if (picked.canceled) return;
          const asset = picked.assets[0];
          const form = new FormData();
          form.append('bookId', bookId);
          form.append('fileName', asset.name);
          form.append('mimeType', asset.mimeType ?? 'audio/mpeg');
          logClient('audio attach:start', { name: asset.name });
          const audio = await apiFetch<{ id: string }>('/audiobooks/attach', { method: 'POST', body: form });
          setMessage(`Attached ${asset.name}`);
          router.push({ pathname: '/audiobooks/align', params: { bookId, audioFileId: audio.id } });
        }}>Choose Audio</Button>
        {message ? <BodyText>{message}</BodyText> : null}
      </Card>
    </Screen>
  );
}
