import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams } from 'expo-router';
import { BodyText, Button, Card, Input } from '../../src/components/Controls';
import { Screen } from '../../src/components/Screen';
import { apiFetch, logClient } from '../../src/lib/api';

export default function AudioProgressAlign() {
  const { bookId, audioFileId } = useLocalSearchParams<{ bookId: string; audioFileId?: string }>();
  const [chapter, setChapter] = useState('1');
  const [timestamp, setTimestamp] = useState('0');
  const [result, setResult] = useState('');
  return (
    <Screen title="Audio Progress Align">
      <Card>
        <BodyText>Paid alignment transcribes a short window around your timestamp and matches it to the canonical EPUB chapter. Low-confidence matches do not move your offset.</BodyText>
        <Input placeholder="Chapter" value={chapter} onChangeText={setChapter} keyboardType="numeric" />
        <Input placeholder="Timestamp seconds" value={timestamp} onChangeText={setTimestamp} keyboardType="numeric" />
        <Button onPress={async () => {
          const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true });
          if (picked.canceled) return;
          const asset = picked.assets[0];
          const form = new FormData();
          form.append('bookId', bookId);
          if (audioFileId) form.append('audioFileId', audioFileId);
          form.append('chapterNumber', chapter);
          form.append('timestampSeconds', timestamp);
          form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'audio/mpeg' } as unknown as Blob);
          logClient('audio align:start', { chapter, timestamp });
          const response = await apiFetch('/audiobooks/align-progress', { method: 'POST', body: form });
          logClient('audio align:result', response);
          setResult(JSON.stringify(response, null, 2));
        }}>Upload Window/File & Align</Button>
        {result ? <BodyText>{result}</BodyText> : null}
      </Card>
    </Screen>
  );
}
