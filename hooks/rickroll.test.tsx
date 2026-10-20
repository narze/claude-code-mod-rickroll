import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const CACHE = '/Users/rick/.cache/claude-rickroll'
const YT_ARGS = [
  '-q', '--no-warnings', '-S', 'res:360,ext:mp4:m4a', '--merge-output-format', 'mp4',
  '-o', `${CACHE}/video.mp4`, URL,
]

const ok = (stdout = '') => ({
  value: {
    exitCode: 0,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

// A host with yt-dlp and ffmpeg, an empty cache, and a speaker.
const host = (on: On, failing: string[] = []) => {
  const ran: string[][] = []
  const played: string[][] = []
  const opened: unknown[] = []
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    if (failing.includes(e.argv[0] ?? '')) {
      return { value: { ...ok().value, exitCode: 1, stderr: 'HTTP Error 403' } }
    }
    return ok(e.argv[0] === 'printenv' ? '/Users/rick\n' : '')
  })
  on('process.spawn', async function* (_$, e) {
    played.push([...e.argv])
    yield* []
    return { value: { code: 0, signal: null } }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  on('fs.list', async () => ({
    value: ['f_00001.png', 'f_00002.png', 'f_00003.png'].map(name => ({
      name,
      kind: 'file' as const,
      size: 1,
      mtimeMs: 0,
      isLink: false,
    })),
  }))
  on('ui.open', async (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })

  return { ran, played, opened }
}

const runRickroll = { command: 'rickroll', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 160 } }

test('/rickroll plays the video in a pane, not in the browser', async ($, on) => {
  const clock = mock.clock(on)
  const { ran, played } = host(on)

  await $.command.run(runRickroll)
  await clock.settle()

  expect(ran).toContainEqual([
    'yt-dlp', ...YT_ARGS,
  ])
  expect(ran.some(argv => argv[0] === 'open' || argv[0] === 'xdg-open')).toBe(false)
  expect(played).toEqual([
    ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', `${CACHE}/video.mp4`],
  ])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'rickroll',
      surface,
      component: 'Pane',
      requestId: 'rickroll',
      viewport: { columns: 100, rows: 30 },
      props: {
        title: 'Free Claude Max upgrade',
        isFocused: false,
        bodyColumns: 100,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    // Only the terminal reads the frames from disk; elsewhere Rick sings.
    if (surface === 'terminal') {
      // A 4:3 picture fits the 100 x 30 body: 80 columns by 30 rows.
      const image = await ui.find({ type: 'Image', key: 'video' })
      expect(image?.props).toMatchObject({ columns: 80, rows: 30 })
      expect(await ui.find({ type: 'Box', key: 'stage' })).toMatchObject({
        props: { width: 100, height: 30, justifyContent: 'center', alignItems: 'center' },
      })
    } else {
      expect(await ui.find({ type: 'Text', text: /Never gonna/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('an old yt-dlp falls back to the newest one through uvx', async ($, on) => {
  const clock = mock.clock(on)
  const { ran, played } = host(on, ['yt-dlp'])

  await $.command.run(runRickroll)
  await clock.settle()

  expect(ran).toContainEqual([
    'uvx', '--from', 'yt-dlp[default]', 'yt-dlp', ...YT_ARGS,
  ])
  expect(played.length).toBe(1)
})

test('the band baits with a claim button on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'rickroll',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 3,
        bodyColumns: 120,
        scroll: { offset: 0, bodyRows: 3 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Button', key: 'claim' })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Never gonna/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('claiming Claude Max opens the pane and plays the video', async ($, on) => {
  const clock = mock.clock(on)
  const { played, opened } = host(on)

  const ui = await $.ui.mount({
    plugin: 'rickroll',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 3,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 3 },
      view: {},
    },
  })
  await ui.press({ key: 'claim' })
  await clock.settle()
  await ui.unmount()

  expect(opened).toEqual([{ id: 'rickroll', title: 'Free Claude Max upgrade' }])
  expect(played).toEqual([
    ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', `${CACHE}/video.mp4`],
  ])
})

test('the session starts with no status line entry', async ($, on) => {
  const statuses: unknown[] = []
  on('ui.status', async (_$, e) => {
    statuses.push(e)
    return { value: undefined }
  })
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/Users/rick', surface: 'terminal', isInteractive: true })

  expect(statuses).toEqual([])
})
