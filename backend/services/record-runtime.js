const path = require('path');

function segmentSeconds(task) {
  const value = Number(task?.segment_seconds || 6);
  if (!Number.isInteger(value) || value < 2 || value > 3600) throw new Error('segment_seconds must be 2-3600');
  return value;
}

function finalExtension(task) {
  if (task.format === 'mp4') return 'mp4';
  if (task.format === 'ts') return 'ts';
  if (task.format === 'audio') return task.audio_format === 'mp3' ? 'mp3' : 'aac';
  throw new Error(`Unsupported recording format: ${task.format}`);
}

function buildCaptureArgs(sourceUrl, workDir, task) {
  if (!sourceUrl) throw new Error('Recording source URL is required');
  if (!path.isAbsolute(workDir)) throw new Error('Recording workDir must be absolute');
  const output = path.join(workDir, 'segment-%06d.ts');
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'warning', '-i', sourceUrl];
  if (task.format === 'audio') args.push('-vn', '-map', '0:a:0?');
  else args.push('-map', '0:v:0?', '-map', '0:a:0?');
  args.push('-c', 'copy', '-f', 'segment', '-segment_time', String(segmentSeconds(task)), '-reset_timestamps', '1', '-segment_format', 'mpegts', output);
  return args;
}

function buildFinalizeArgs(concatFile, finalPath, task) {
  if (!path.isAbsolute(concatFile) || !path.isAbsolute(finalPath)) throw new Error('Finalize paths must be absolute');
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', concatFile];
  if (task.format === 'mp4') return [...args, '-c', 'copy', '-movflags', '+faststart', finalPath];
  if (task.format === 'ts') return [...args, '-c', 'copy', '-f', 'mpegts', finalPath];
  if (task.format === 'audio') {
    const muxer = task.audio_format === 'mp3' ? 'mp3' : 'adts';
    return [...args, '-vn', '-c:a', 'copy', '-f', muxer, finalPath];
  }
  throw new Error(`Unsupported recording format: ${task.format}`);
}

module.exports = { segmentSeconds, finalExtension, buildCaptureArgs, buildFinalizeArgs };
