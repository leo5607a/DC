const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const path = require("path");
const { consumers } = require("stream");
const _dirname = path.resolve()

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
    cors:{
        origin: "http://127.0.0.1:5500"
    }
 });

httpServer.listen(3000);
const peers = io.of('/mediasoup')

app.get("/",(req, res) => {
    res.send("Hello from mediasoup app!")
})

app.use('/sfu', express.static(path.join(_dirname, 'Client')))

io.on("connection", (socket) => {
});

let worker
let router
let producerTransport
let consumerTransport
let producer
let consumer

const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    })
    console.log(`worker pid ${worker.pid}`)

    worker.on('died', error => {
        console.error('mediasoup worker has died')
        setTimeout(() => process.exit(1), 2000)
    })

    return worker
}

worker = createWorker()

const mediaCodecs = [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 1000,
      },
    },
  ]

peers.on("connection", async socket => {
    if(router === undefined){
        router = await worker.createRouter({ mediaCodecs})
    }

    socket.on("getRtpCapabilities", (callback) => {
        const rtpCapabilities = router.rtpCapabilities
        console.log('Rtp Capabilitie', rtpCapabilities)
        callback({rtpCapabilities})
    })

    socket.on('createWebRTCTransport', async ({ sender }, callback) => {
        console.log(`Is this a sender request? ${sender}`)

        if(sender){
            producerTransport = await createWebRTCTransport(callback)
        }else{
            consumerTransport = await createWebRTCTransport(callback)
        }
    })

    socket.on('transport-connect', async ({ dtlsParameters }) => {
        console.log('DTLS PARAMS... ', { dtlsParameters })
        await producerTransport.connect({ dtlsParameters })
    })

    socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {

        producer = await producerTransport.produce({
            kind,
            rtpParameters,
        })

        console.log('Producer ID: ', producer.id, producer.kind)

        producer.on('transportclose', () => {
            console.log('transport for this producer closed ')
            producer.close()
        })

        // Send back to the client the Producer's id
        callback({
            id: producer.id
        })
    })

    socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
        console.log('DTLS PARAMS... ', { dtlsParameters })
        await consumerTransport.connect({ dtlsParameters })
    })

    socket.on('consume', async ({ rtpCapabilities }, callback) => {
        try {
            if(router.canConsume({ 
                producerId: producer.id, 
                rtpCapabilities 
            })){
                consumer = await consumerTransport.consume({ 
                    producerId: producer.id, 
                    rtpCapabilities, 
                    paused: true 
                })

                consumer.on('transportclose', () => {
                    console.log('transport close from consumer')
                })
        
                consumer.on('producerclose', () => {
                    console.log('producer of consumer closed')
                })

                const params = {
                    id: consumer.id,
                    producerId: producer.id,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                }

                callback({ params })
            }
        } catch (error) {
            console.log(error.message)
            callback({
                params: {
                    error
                }
            })
        }
    })

    socket.on('consumer-resume', async () => {
        console.log('consumer resume')
        await consumer.resume()
    })
})

const createWebRTCTransport = async (callback) => {
    try {
        const webRtcTransport_options = {
        listenIps: [
            {
                ip: '0.0.0.0',
                announcedIp: '127.0.0.1',
            }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        }

        let transport = await router.createWebRtcTransport(webRtcTransport_options)
        console.log(`transport id: ${transport.id}`)

        transport.on('dtlsstatechange', dtlsState => {
            if (dtlsState === 'closed') {
            transport.close()
            }
        })

        transport.on('close', () => {
            console.log('transport closed')
        })

        callback({
            params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            }
        })

        return transport
    } catch (error) {
        console.log(error);
        callback({
            params: {
                error:error
            }
        })
    }
}