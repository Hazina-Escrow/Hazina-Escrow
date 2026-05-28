import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import WebSocket from 'ws';
import { WebSocketServer_Hazina, initializeWebSocketServer } from '../ws-server';
import { transactionEventEmitter } from '../transaction-events';

describe('WebSocket Server', () => {
  let server: http.Server;
  let wsServer: WebSocketServer_Hazina;
  let wsUrl: string;
  let port: number;

  beforeAll(async () => {
    const app = express();
    server = http.createServer(app);

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
          wsUrl = `ws://localhost:${port}/ws`;
          wsServer = initializeWebSocketServer(server, 'test-api-key');
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    wsServer.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('should accept WebSocket connections', () =>
    new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      client.on('open', () => {
        expect(client.readyState).toBe(WebSocket.OPEN);
        client.close();
        resolve();
      });
      client.on('error', reject);
    }));

  it('should handle subscribe messages', () =>
    new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      client.on('open', () => {
        client.send(
          JSON.stringify({
            type: 'subscribe',
            datasetIds: ['dataset-1', 'dataset-2'],
            transactionIds: ['tx-1'],
          }),
        );
      });
      client.on('message', data => {
        const msg = JSON.parse(data.toString());
        expect(msg.datasetIds).toContain('dataset-1');
        expect(msg.datasetIds).toContain('dataset-2');
        expect(msg.transactionIds).toContain('tx-1');
        client.close();
        resolve();
      });
      client.on('error', reject);
    }));

  it('should handle ping/pong', () =>
    new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'ping' }));
      });
      client.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') {
          expect(msg.type).toBe('pong');
          client.close();
          resolve();
        }
      });
      client.on('error', reject);
    }));

  it('should broadcast transaction updates to subscribed clients', () =>
    new Promise<void>((resolve, reject) => {
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);
      let client1Ready = false;
      let client2Ready = false;

      client1.on('open', () => {
        client1.send(JSON.stringify({ type: 'subscribe', datasetIds: ['dataset-123'] }));
        client1Ready = true;
      });

      client2.on('open', () => {
        client2.send(JSON.stringify({ type: 'subscribe', datasetIds: ['dataset-123'] }));
        client2Ready = true;

        setTimeout(() => {
          if (client1Ready && client2Ready) {
            transactionEventEmitter.updateTransactionStatus(
              'tx-test-123',
              'dataset-123',
              'pending',
            );
          }
        }, 100);
      });

      client2.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'transaction:update' && msg.data.transactionId === 'tx-test-123') {
          client1.close();
          client2.close();
          resolve();
        }
      });

      client1.on('error', reject);
      client2.on('error', reject);
    }));

  it('should not broadcast to non-subscribed clients', () =>
    new Promise<void>((resolve, reject) => {
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);
      let client1Ready = false;
      let client2Ready = false;

      const timeoutId = setTimeout(() => {
        client1.close();
        client2.close();
        resolve();
      }, 500);

      client1.on('open', () => {
        client1.send(JSON.stringify({ type: 'subscribe', datasetIds: ['dataset-456'] }));
        client1Ready = true;
      });

      client2.on('open', () => {
        client2.send(JSON.stringify({ type: 'subscribe', datasetIds: ['dataset-789'] }));
        client2Ready = true;

        setTimeout(() => {
          if (client1Ready && client2Ready) {
            transactionEventEmitter.updateTransactionStatus(
              'tx-test-456',
              'dataset-456',
              'completed',
            );
          }
        }, 100);
      });

      client2.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'transaction:update' && msg.data.datasetId === 'dataset-456') {
          clearTimeout(timeoutId);
          client1.close();
          client2.close();
          reject(new Error('Client2 should not have received dataset-456 update'));
        }
      });

      client1.on('error', error => {
        clearTimeout(timeoutId);
        reject(error);
      });
      client2.on('error', error => {
        clearTimeout(timeoutId);
        reject(error);
      });
    }));

  it('should handle multiple event types', () =>
    new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      const receivedEvents: string[] = [];

      client.on('open', () => {
        client.send(JSON.stringify({ type: 'subscribe', datasetIds: ['dataset-multi'] }));
        setTimeout(() => {
          transactionEventEmitter.receivePayment('tx-multi', 'dataset-multi', '100');
          transactionEventEmitter.forwardPayment('tx-multi', 'dataset-multi', '95', '5');
          transactionEventEmitter.queryDataset('tx-multi', 'dataset-multi', 1);
        }, 100);
      });

      client.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'payment:received') receivedEvents.push('payment:received');
        else if (msg.type === 'payment:forwarded') receivedEvents.push('payment:forwarded');
        else if (msg.type === 'dataset:queried') receivedEvents.push('dataset:queried');

        if (
          receivedEvents.includes('payment:received') &&
          receivedEvents.includes('payment:forwarded') &&
          receivedEvents.includes('dataset:queried')
        ) {
          client.close();
          resolve();
        }
      });

      client.on('error', reject);
    }));

  it('should track connected clients', () =>
    new Promise<void>(resolve => {
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);

      client1.on('open', () => {
        const count = wsServer.getConnectedClients();
        expect(count).toBeGreaterThan(0);

        client2.on('open', () => {
          const count2 = wsServer.getConnectedClients();
          expect(count2).toBeGreaterThan(count);
          client1.close();
          client2.close();
          resolve();
        });
      });

      client1.on('error', () => {
        /* ignore */
      });
      client2.on('error', () => {
        /* ignore */
      });
    }));

  it('should reject invalid messages', () =>
    new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      client.on('open', () => {
        client.send('not valid json');
      });
      client.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') {
          expect(msg.code).toBe('PARSE_ERROR');
          client.close();
          resolve();
        }
      });
      client.on('error', reject);
    }));
    await new Promise<void>(resolve => server.listen(0, resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr !== null) {
      port = addr.port;
      wsUrl = `ws://localhost:${port}/ws`;
      wsServer = initializeWebSocketServer(server, 'test-api-key');
    }
  });

  afterAll(async () => {
    if (wsServer) wsServer.shutdown();
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve())),
    );
  });

  it('should accept WebSocket connections', () => {
    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on('open', () => {
        try {
          expect(client.readyState).toBe(WebSocket.OPEN);
          client.close();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      client.on('error', error => {
        reject(error);
      });
    });
  });

  it('should handle subscribe messages', () => {
    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on('open', () => {
        const subscribe = {
          type: 'subscribe',
          datasetIds: ['dataset-1', 'dataset-2'],
          transactionIds: ['tx-1'],
        };
        client.send(JSON.stringify(subscribe));
      });

      client.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          expect(msg.datasetIds).toContain('dataset-1');
          expect(msg.datasetIds).toContain('dataset-2');
          expect(msg.transactionIds).toContain('tx-1');
          client.close();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      client.on('error', error => {
        reject(error);
      });
    });
  });

  it('should handle ping/pong', () => {
    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on('open', () => {
        client.send(JSON.stringify({ type: 'ping' }));
      });

      client.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pong') {
            expect(msg.type).toBe('pong');
            client.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      });

      client.on('error', error => {
        reject(error);
      });
    });
  });

  it('should broadcast transaction updates to subscribed clients', () => {
    return new Promise<void>((resolve, reject) => {
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);
      let client1Ready = false;
      let client2Ready = false;
      let client2ReceivedUpdate = false;

      const checkDone = () => {
        if (client2ReceivedUpdate) {
          client1.close();
          client2.close();
          resolve();
        }
      };

      client1.on('open', () => {
        client1.send(
          JSON.stringify({
            type: 'subscribe',
            datasetIds: ['dataset-123'],
          }),
        );
        client1Ready = true;
      });

      client2.on('open', () => {
        client2.send(
          JSON.stringify({
            type: 'subscribe',
            datasetIds: ['dataset-123'],
          }),
        );
        client2Ready = true;

        // Wait a moment then emit an event
        setTimeout(() => {
          if (client1Ready && client2Ready) {
            transactionEventEmitter.updateTransactionStatus(
              'tx-test-123',
              'dataset-123',
              'pending',
            );
          }
        }, 100);
      });

      client2.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'transaction:update' && msg.data.transactionId === 'tx-test-123') {
            client2ReceivedUpdate = true;
            checkDone();
          }
        } catch (err) {
          reject(err);
        }
      });

      client1.on('error', error => {
        reject(error);
      });

      client2.on('error', error => {
        reject(error);
      });
    });
  });

  it('should not broadcast to non-subscribed clients', () => {
    return new Promise<void>((resolve, reject) => {
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);
      let client1Ready = false;
      let client2Ready = false;
      const timeoutId = setTimeout(() => {
        // If no message received within timeout, test passes
        try {
          expect(true).toBe(true);
          client1.close();
          client2.close();
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 500);

      client1.on('open', () => {
        // Client1 subscribes to dataset-456
        client1.send(
          JSON.stringify({
            type: 'subscribe',
            datasetIds: ['dataset-456'],
          }),
        );
        client1Ready = true;
      });

      client2.on('open', () => {
        // Client2 subscribes to dataset-789
        client2.send(
          JSON.stringify({
            type: 'subscribe',
            datasetIds: ['dataset-789'],
          }),
        );
        client2Ready = true;

        setTimeout(() => {
          if (client1Ready && client2Ready) {
            // Emit event for dataset-456 (client1 subscribed)
            transactionEventEmitter.updateTransactionStatus(
              'tx-test-456',
              'dataset-456',
              'completed',
            );
          }
        }, 100);
      });

      client2.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          // Should not receive the transaction:update for dataset-456
          if (msg.type === 'transaction:update' && msg.data.datasetId === 'dataset-456') {
            clearTimeout(timeoutId);
            client1.close();
            client2.close();
            reject(new Error('Client2 should not have received dataset-456 update'));
          }
        } catch (err) {
          clearTimeout(timeoutId);
          reject(err);
        }
      });

      client1.on('error', error => {
        clearTimeout(timeoutId);
        reject(error);
      });

      client2.on('error', error => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  });

  it('should handle multiple event types', () => {
    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);
      const receivedEvents: string[] = [];

      client.on('open', () => {
        client.send(
          JSON.stringify({
            type: 'subscribe',
            datasetIds: ['dataset-multi'],
          }),
        );

        setTimeout(() => {
          transactionEventEmitter.receivePayment('tx-multi', 'dataset-multi', '100');
          transactionEventEmitter.forwardPayment('tx-multi', 'dataset-multi', '95', '5');
          transactionEventEmitter.queryDataset('tx-multi', 'dataset-multi', 1);
        }, 100);
      });

      client.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'payment:received') {
            receivedEvents.push('payment:received');
          } else if (msg.type === 'payment:forwarded') {
            receivedEvents.push('payment:forwarded');
          } else if (msg.type === 'dataset:queried') {
            receivedEvents.push('dataset:queried');
          }

          if (
            receivedEvents.includes('payment:received') &&
            receivedEvents.includes('payment:forwarded') &&
            receivedEvents.includes('dataset:queried')
          ) {
            client.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      });

      client.on('error', error => {
        reject(error);
      });
    });
  });

  it('should track connected clients', () => {
    return new Promise<void>((resolve, reject) => {
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);

      client1.on('open', () => {
        try {
          const count = wsServer.getConnectedClients();
          expect(count).toBeGreaterThan(0);

          client2.on('open', () => {
            try {
              const count2 = wsServer.getConnectedClients();
              expect(count2).toBeGreaterThanOrEqual(count);

              client1.close();
              client2.close();
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        } catch (err) {
          reject(err);
        }
      });

      client1.on('error', () => {
        /* ignore */
      });
      client2.on('error', () => {
        /* ignore */
      });
    });
  });

  it('should reject invalid messages', () => {
    return new Promise<void>((resolve, reject) => {
      const client = new WebSocket(wsUrl);

      client.on('open', () => {
        // Send invalid JSON
        client.send('not valid json');
      });

      client.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'error') {
            expect(msg.code).toBe('PARSE_ERROR');
            client.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      });

      client.on('error', error => {
        reject(error);
      });
    });
  });
});
