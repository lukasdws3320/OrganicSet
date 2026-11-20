"""Compatibilidade Windows para `fcntl.flock` (adaptação do OrganicSet para Windows).

No Mac/Linux este arquivo se substitui pelo `fcntl` original do Python.
No Windows implementa só o que os scripts do Flow usam: flock com LOCK_EX/LOCK_SH/LOCK_NB/LOCK_UN,
travando o primeiro byte do arquivo com msvcrt.locking.
"""
import sys

if sys.platform != "win32":
    import importlib.machinery, importlib.util, os
    _aqui = os.path.dirname(os.path.abspath(__file__))
    _spec = importlib.machinery.PathFinder.find_spec("fcntl", [p for p in sys.path if os.path.abspath(p or ".") != _aqui])
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    sys.modules[__name__] = _mod
    globals().update(_mod.__dict__)
else:
    import msvcrt, os, time

    LOCK_SH, LOCK_EX, LOCK_NB, LOCK_UN = 1, 2, 4, 8

    def _fd(f):
        return f if isinstance(f, int) else f.fileno()

    def flock(f, op):
        fd = _fd(f)
        pos = os.lseek(fd, 0, os.SEEK_CUR)
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            if op & LOCK_UN:
                try:
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
                return
            while True:
                try:
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                    return
                except OSError:
                    if op & LOCK_NB:
                        raise BlockingIOError("arquivo travado por outra operação")
                    time.sleep(0.1)
                    os.lseek(fd, 0, os.SEEK_SET)
        finally:
            try:
                os.lseek(fd, pos, os.SEEK_SET)
            except OSError:
                pass
