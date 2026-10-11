import { indexRawTransaction } from '@repid/sdk';
import { createJsonFileStore } from '@repid/sdk/node';
import path from 'path';

const CHAINGRAPH_URL = 'https://chipnet.chaingraph.cash/v1/graphql';

const storePath = path.resolve(process.cwd(), 'data/repid-state.json');
export const store = createJsonFileStore(storePath);

export async function runIndexer() {
  console.log('Starting RepID Chaingraph indexer...');
  
  // NOTE: In a real environment, you would query Chaingraph for un-indexed blocks or mempool transactions.
  // For the sake of this demo, we're building the scaffolding.
  // Example GraphQL query:
  // const query = `query { transactions(limit: 10, order_by: { block_inclusive: { height: desc } }) { hash encoded_hex } }`;
  
  try {
    const response = await fetch(CHAINGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          query {
            transaction(limit: 50, order_by: { block_inclusive: { height: desc } }) {
              hash
              encoded_hex
            }
          }
        `,
      }),
    });

    const result = await response.json() as any;

    if (result.errors) {
      console.error('Chaingraph GraphQL Error:', result.errors);
      return;
    }

    const txs = result.data?.transaction || [];
    let factsFound = 0;

    for (const tx of txs) {
      if (tx.encoded_hex) {
        try {
           // We pass the raw hex to the protocol SDK
           const fact = indexRawTransaction(tx.encoded_hex, store);
           if (fact) {
             console.log(`RepID fact found: ${fact.type} in tx ${tx.hash.substring(2)}`);
             factsFound++;
           }
        } catch (e) {
           // transaction cannot be decoded at all
        }
      }
    }
    console.log(`Indexer finished. Found ${factsFound} facts in this run.`);
  } catch (err) {
    console.error('Error fetching from Chaingraph:', err);
  }
}

// End of worker
