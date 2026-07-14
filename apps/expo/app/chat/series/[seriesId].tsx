import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { BodyText, Button, Card, Input } from '../../../src/components/Controls';
import { Screen } from '../../../src/components/Screen';
import { ask } from '../../../src/lib/api';

export default function SeriesChat() {
  const { seriesId } = useLocalSearchParams<{ seriesId: string }>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  return (
    <Screen title="Series Chat">
      <Card>
        <Input placeholder="Ask across what you've read..." value={question} onChangeText={setQuestion} />
        <Button onPress={async () => {
          const response = await ask({ contextType: 'series', contextId: seriesId, question });
          setAnswer((response as { answer: string }).answer);
        }}>Ask</Button>
      </Card>
      {answer ? <Card><BodyText>{answer}</BodyText></Card> : null}
    </Screen>
  );
}
