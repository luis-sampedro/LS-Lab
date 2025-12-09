
import numpy as np
try:
    from skimage.graph import route_through_array
    
    image = np.ones((10, 10))
    start = (0, 0)
    end = (9, 9)
    
    ret = route_through_array(image, start, end)
    print(f"Return Type: {type(ret)}")
    print(f"Return Length: {len(ret)}")
    print(f"Return Value: {ret}")
    
except ImportError:
    print("skimage.graph not found")
except Exception as e:
    print(f"Error: {e}")
