import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Video } from '../types'

export const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const PANE = 'rickroll'
const FPS = 15

const isRolled = atom({ plugin: 'rickroll', key: 'isRolled' } as const, false)
const video = atom({ plugin: 'rickroll', key: 'video' } as const, {
  phase: 'idle',
} as Video)

const framePath = (dir: string, frame: number) =>
  `${dir}/f_${String(frame).padStart(5, '0')}.png`

const run = async ($: EngineInterface, argv: string[]) => {
  const ran = await $.process.run(argv, { timeoutMs: 600_000 })
  if (ran.exitCode !== 0) {
    throw new Error(`${argv[0]} failed: ${ran.stderr.trim().slice(-200)}`)
  }

  return ran.stdout
}

// Downloads the video once and cuts it into PNG frames the terminal reads.
const prepare = async ($: EngineInterface) => {
  const home = (await run($, ['printenv', 'HOME'])).trim()
  const dir = `${home}/.cache/claude-rickroll`
  const mp4 = `${dir}/video.mp4`

  // The marker names the cut, so a new cut replaces old frames.
  const done = `${dir}/done-4x3`

  if (!(await $.fs.exists(done))) {
    await run($, ['mkdir', '-p', dir])

    if (!(await $.fs.exists(mp4))) {
      await update($, video, (): Video => ({ phase: 'preparing', step: 'Downloading Rick...' }))
      const args = [
        '-q', '--no-warnings', '-S', 'res:360,ext:mp4:m4a', '--merge-output-format', 'mp4',
        '-o', mp4, URL,
      ]
      // YouTube often breaks an older yt-dlp: fall back to the newest one.
      try {
        await run($, ['yt-dlp', ...args])
      } catch {
        await run($, ['uvx', '--from', 'yt-dlp[default]', 'yt-dlp', ...args])
      }
    }

    await update($, video, (): Video => ({ phase: 'preparing', step: 'Warming up the dance moves...' }))
    await run($, [
      'ffmpeg', '-y', '-loglevel', 'error', '-i', mp4,
      // The upload is 4:3 with black bars on the sides: cut them off.
      '-vf', `crop=ih*4/3:ih,fps=${FPS},scale=320:-2`, framePath(dir, 0).replace('00000', '%05d'),
    ])
    await $.fs.write(done, '')
  }

  const frames = (await $.fs.list(dir)).filter(entry =>
    /^f_\d{5}\.png$/.test(entry.name),
  ).length

  return { dir, mp4, frames }
}

// The playback of this module copy; a reload starts it over.
let ticker: Timer | undefined
let sound: AsyncIterator<unknown> | undefined

function stop() {
  ticker?.cancel()
  ticker = undefined
  void sound?.return?.()
  sound = undefined
}

async function play($: EngineInterface) {
  stop()
  await update($, video, (): Video => ({ phase: 'preparing', step: 'Loading...' }))
  try {
    const { dir, mp4, frames } = await prepare($)
    const startedAt = await $.clock.now()
    await update($, video, (): Video => ({ phase: 'playing', dir, frames, frame: 1 }))

    const stream = $.process.spawn({
      argv: ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', mp4],
    })[Symbol.asyncIterator]()
    sound = stream
    void (async () => {
      try {
        while (!(await stream.next()).done);
      } catch {
        $.ui.toast('No ffplay found: Rick dances in silence')
      }
    })()

    ticker = $.clock.every(1000 / FPS, async () => {
      const frame = Math.floor(((await $.clock.now()) - startedAt) / (1000 / FPS)) + 1
      if (frame > frames) {
        stop()
        await update($, video, (): Video => ({ phase: 'done' }))
        return
      }
      await $.ui.blit({
        requestId: PANE,
        key: 'video',
        source: { file: framePath(dir, frame), format: 'png' },
      })
    })
  } catch (error) {
    stop()
    const reason = error instanceof Error ? error.message : String(error)
    await update($, video, (): Video => ({ phase: 'failed', reason }))
  }
}

async function roll($: EngineInterface) {
  // Open first, while the press or command is still behind the call: an asked
  // pane is placed at any width, an unasked one waits for a wide terminal.
  const opened = await $.ui.open({ id: PANE, title: 'Free Claude Max upgrade' })
  if (!opened.isPlaced) $.ui.toast(`Rick is waiting off stage: ${opened.reason}`)
  $.ui.toast('Never gonna give you up, never gonna let you down')
  await update($, isRolled, () => true)
  void play($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rickroll',
      description: 'Claim your free Claude upgrade',
    })

    return next(e)
  })

  on('command.run', { command: 'rickroll' }, async $ => {
    await roll($)

    return { text: 'You just got rickrolled.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      stop()
      void update($, video, (): Video => ({ phase: 'idle' })).catch(() => {})
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await read($, video)

    // Only the terminal reads the frames from disk; elsewhere Rick sings.
    if (now.phase === 'playing' && e.surface !== 'terminal') {
      return <Text color="magenta">♪ Never gonna give you up (turn up the sound)</Text>
    }

    if (now.phase !== 'playing' || e.surface !== 'terminal') {
      const words =
        now.phase === 'preparing' ? now.step
        : now.phase === 'failed' ? `Rick could not make it: ${now.reason}`
        : now.phase === 'done' ? 'You just got rickrolled.'
        : 'Never gonna give you up'

      return (
        <Box flexDirection="column">
          <Text color="magenta">♪ {words}</Text>
        </Box>
      )
    }

    const { Image } = $.ui.resolve(e)
    // Cells are about twice as tall as wide: 4:3 pixels are 8:3 cells.
    const width = Math.max(8, e.props.bodyColumns)
    const height = Math.max(3, e.props.scroll.bodyRows)
    const columns = Math.min(255, width, Math.floor((height * 8) / 3))
    const rows = Math.min(255, Math.max(1, Math.round((columns * 3) / 8)))

    return (
      <Box
        key="stage"
        width={width}
        height={height}
        justifyContent="center"
        alignItems="center"
      >
        <Image
          key="video"
          source={{ file: framePath(now.dir, now.frame), format: 'png' }}
          columns={columns}
          rows={rows}
          alt="Never gonna give you up (your terminal cannot draw pictures)"
        />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    if (await read($, isRolled)) return next(e)

    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box>
        <Button
          key="claim"
          label="🎁 Claim your free Claude Max upgrade"
          onPress={() => void roll($)}
        />
      </Box>
    )
  })
}
